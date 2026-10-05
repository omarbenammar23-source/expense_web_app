const fs = require("fs/promises");
const { recognizeBestOcr } = require("../controllers/ocrController");

const GOOGLE_VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const GOOGLE_VISION_REASON = "Similar receipt image found on the public web";
const WEB_MATCH_SCORE_THRESHOLD = 45;
const MAX_ANALYZED_SOURCES = 6;
const MAX_ANALYZED_IMAGE_SOURCES = 3;
const MAX_RETURNED_SOURCES = 6;
const FETCH_TIMEOUT_MS = 12000;
const DIRECT_PROVIDER_MATCH_KINDS = new Set([
  "full-image",
  "page-full-image",
  "partial-image",
  "page-partial-image",
  "matching-page"
]);
const COMMON_KEYWORDS = new Set([
  "invoice",
  "receipt",
  "restaurant",
  "hotel",
  "bill",
  "payment",
  "amount",
  "total",
  "subtotal",
  "grand",
  "item",
  "items",
  "table",
  "date",
  "invoice",
  "from",
  "with",
  "this",
  "that",
  "your",
  "company",
  "ltd",
  "inc",
  "street",
  "suite",
  "bank",
  "account"
]);

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const normalizeIsoDate = (value) => {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeAmount = (rawValue) => {
  if (!rawValue) return null;

  const trimmedRawValue = String(rawValue).replace(/[$\u20AC\u00A3]/g, "").trim();
  let value = trimmedRawValue.replace(/\s+/g, "").trim();
  if (!value) return null;

  if (!/[.,]/.test(trimmedRawValue) && /^\d+\s\d{2}$/.test(trimmedRawValue)) {
    value = trimmedRawValue.replace(/\s+/, ".");
  }

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    value = value.replace(new RegExp(`\\${thousandSeparator}`, "g"), "");
    value = value.replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    const commaCount = (value.match(/,/g) || []).length;
    const digitsAfterComma = value.length - lastComma - 1;

    if (commaCount > 1 || digitsAfterComma === 3) {
      value = value.replace(/,/g, "");
    } else {
      value = value.replace(",", ".");
    }
  } else if (lastDot !== -1) {
    const dotCount = (value.match(/\./g) || []).length;
    const digitsAfterDot = value.length - lastDot - 1;

    if (dotCount > 1 || digitsAfterDot === 3) {
      value = value.replace(/\./g, "");
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getUniqueSources = (items) => {
  const seen = new Set();
  const sources = [];

  items.forEach((item) => {
    if (!item?.url) {
      return;
    }

    try {
      const normalized = new URL(item.url).toString();
      if (seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      sources.push({
        ...item,
        url: normalized
      });
    } catch (_) {
      if (seen.has(item.url)) {
        return;
      }

      seen.add(item.url);
      sources.push(item);
    }
  });

  return sources;
};

const addSourceEntry = (entries, url, kind, providerScore) => {
  if (!url) {
    return;
  }

  const existing = entries.get(url);

  if (existing) {
    existing.provider_score = Math.max(existing.provider_score, providerScore);
    if (!existing.kinds.includes(kind)) {
      existing.kinds.push(kind);
    }
    return;
  }

  entries.set(url, {
    url,
    kinds: [kind],
    provider_score: providerScore
  });
};

const getWebMatchEntries = (webDetection = {}) => {
  const entries = new Map();

  (webDetection.pagesWithMatchingImages || []).forEach((page) => {
    addSourceEntry(entries, page.url, "matching-page", 45);
    (page.fullMatchingImages || []).forEach((image) =>
      addSourceEntry(entries, image.url, "page-full-image", 85)
    );
    (page.partialMatchingImages || []).forEach((image) =>
      addSourceEntry(entries, image.url, "page-partial-image", 60)
    );
  });

  (webDetection.fullMatchingImages || []).forEach((image) =>
    addSourceEntry(entries, image.url, "full-image", 90)
  );
  (webDetection.partialMatchingImages || []).forEach((image) =>
    addSourceEntry(entries, image.url, "partial-image", 65)
  );
  (webDetection.visuallySimilarImages || []).forEach((image) =>
    addSourceEntry(entries, image.url, "visually-similar-image", 30)
  );

  return getUniqueSources([...entries.values()])
    .sort((left, right) => right.provider_score - left.provider_score)
    .slice(0, 12);
};

const buildAmountFormats = (amount) => {
  const numericAmount = normalizeAmount(amount);
  if (numericAmount == null) {
    return [];
  }

  const fixed = numericAmount.toFixed(2);
  const [whole, cents] = fixed.split(".");
  const commaWhole = Number(whole).toLocaleString("en-US");
  const dotWhole = Number(whole).toLocaleString("de-DE").replace(/,/g, ".");

  return [...new Set([
    fixed,
    `${whole}.${cents}`,
    `${whole},${cents}`,
    `${commaWhole}.${cents}`,
    `${commaWhole},${cents}`,
    `${dotWhole}.${cents}`,
    `${dotWhole},${cents}`
  ])];
};

const buildDateFormats = (isoDate) => {
  const normalized = normalizeIsoDate(isoDate);
  if (!normalized) {
    return [];
  }

  const [year, month, day] = normalized.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const monthName = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const shortMonthName = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });

  return [...new Set([
    normalized,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day}/${month}/${year.slice(-2)}`,
    `${day}-${month}-${year.slice(-2)}`,
    `${monthName} ${Number(day)}, ${year}`,
    `${shortMonthName} ${Number(day)}, ${year}`,
    `${Number(day)} ${monthName} ${year}`,
    `${Number(day)} ${shortMonthName} ${year}`
  ])];
};

const tokenizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !COMMON_KEYWORDS.has(token));

const unique = (items) => [...new Set(items.filter(Boolean))];

const buildReceiptKeywords = (expense, ocrResult) => {
  const headerLines = String(ocrResult?.text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");

  return unique(tokenizeText(`${expense?.title || ""} ${headerLines}`)).slice(0, 12);
};

const buildReceiptProfile = (expense = {}, ocrResult = {}) => {
  const totalAmount = normalizeAmount(expense.amount) ?? normalizeAmount(ocrResult?.extracted?.total);
  const amountCandidates = unique(
    [
      totalAmount,
      ocrResult?.extracted?.total,
      ocrResult?.extracted?.subtotal,
      ocrResult?.extracted?.vat,
      ...(ocrResult?.candidates?.amounts || []).map((candidate) => candidate.amount)
    ]
      .map((value) => normalizeAmount(value))
      .filter((value) => value != null)
      .map((value) => roundMoney(value))
  ).slice(0, 12);

  return {
    total: totalAmount != null ? roundMoney(totalAmount) : null,
    date: normalizeIsoDate(expense.expense_date) || normalizeIsoDate(ocrResult?.extracted?.date),
    amounts: amountCandidates,
    keywords: buildReceiptKeywords(expense, ocrResult),
    tokens: unique(tokenizeText(ocrResult?.text || "")).slice(0, 50),
    text: String(ocrResult?.text || "")
  };
};

const extractPlainTextFromHtml = (html) =>
  String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "expense-app-fraud-check/1.0",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchRemoteImageOcr = async (url) => {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Source is not an image");
  }

  const arrayBuffer = await response.arrayBuffer();
  return recognizeBestOcr(Buffer.from(arrayBuffer));
};

const fetchRemotePageText = async (url) => {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Page fetch failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error("Source is not an HTML page");
  }

  const html = await response.text();
  return extractPlainTextFromHtml(html).slice(0, 25000);
};

const extractAmountsFromText = (text) => {
  const matches = String(text || "").match(/[$\u20AC\u00A3]?\s*-?(?:\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{2})|\d+[.,]\d{2}|\d+\s\d{2})/g) || [];
  return unique(
    matches
      .map((value) => normalizeAmount(value))
      .filter((value) => value != null)
      .map((value) => roundMoney(value))
  );
};

const getKeywordMatches = (receiptProfile, comparisonText) => {
  const lowerText = String(comparisonText || "").toLowerCase();
  return receiptProfile.keywords.filter((keyword) => lowerText.includes(keyword)).slice(0, 5);
};

const getTokenOverlapScore = (receiptTokens, comparisonTokens) => {
  if (!receiptTokens.length || !comparisonTokens.length) {
    return 0;
  }

  const comparisonSet = new Set(comparisonTokens);
  const overlapCount = receiptTokens.filter((token) => comparisonSet.has(token)).length;
  return overlapCount / Math.max(receiptTokens.length, 1);
};

const buildMatchDetails = (entry, receiptProfile, comparison) => {
  let score = Number(entry.provider_score || 0);
  const reasons = [];
  const comparisonText = comparison.text || "";
  const comparisonAmounts = comparison.amounts || [];
  const comparisonDate = normalizeIsoDate(comparison.date);
  const comparisonTokens = comparison.tokens || [];

  if (receiptProfile.total != null) {
    const hasExactTotal = comparisonAmounts.some((amount) => amount === receiptProfile.total);
    const hasTextTotal = buildAmountFormats(receiptProfile.total).some((format) => comparisonText.includes(format));

    if (hasExactTotal || hasTextTotal) {
      score += 35;
      reasons.push(`Same total amount found (${receiptProfile.total.toFixed(2)})`);
    }
  }

  if (receiptProfile.date) {
    const hasDateMatch =
      comparisonDate === receiptProfile.date ||
      buildDateFormats(receiptProfile.date).some((format) =>
        comparisonText.toLowerCase().includes(format.toLowerCase())
      );

    if (hasDateMatch) {
      score += 20;
      reasons.push(`Same date found (${receiptProfile.date})`);
    }
  }

  const secondaryAmountMatches = receiptProfile.amounts.filter(
    (amount) => amount !== receiptProfile.total && comparisonAmounts.includes(amount)
  );
  if (secondaryAmountMatches.length >= 2) {
    score += 15;
    reasons.push(`Matched ${secondaryAmountMatches.length} supporting amounts`);
  } else if (secondaryAmountMatches.length === 1) {
    score += 8;
    reasons.push("Matched one supporting amount");
  }

  const matchedKeywords = getKeywordMatches(receiptProfile, comparisonText);
  if (matchedKeywords.length >= 3) {
    score += 18;
    reasons.push(`Matched keywords: ${matchedKeywords.slice(0, 3).join(", ")}`);
  } else if (matchedKeywords.length >= 1) {
    score += 8;
    reasons.push(`Matched keyword: ${matchedKeywords[0]}`);
  }

  const overlapScore = getTokenOverlapScore(receiptProfile.tokens, comparisonTokens);
  if (overlapScore >= 0.25) {
    score += 20;
    reasons.push("OCR text looks very similar");
  } else if (overlapScore >= 0.12) {
    score += 10;
    reasons.push("OCR text has noticeable overlap");
  }

  return {
    url: entry.url,
    kinds: entry.kinds,
    provider_score: entry.provider_score,
    score: Math.min(100, score),
    reasons,
    matched_amounts: secondaryAmountMatches,
    matched_date: comparisonDate === receiptProfile.date ? receiptProfile.date : null
  };
};

const analyzeSourceEntry = async (entry, receiptProfile) => {
  const isImageSource = entry.kinds.some((kind) => kind.includes("image"));

  try {
    if (isImageSource) {
      const remoteOcr = await fetchRemoteImageOcr(entry.url);
      return buildMatchDetails(entry, receiptProfile, {
        text: remoteOcr.text || "",
        tokens: tokenizeText(remoteOcr.text || ""),
        amounts: unique(
          [
            remoteOcr?.extracted?.total,
            remoteOcr?.extracted?.subtotal,
            remoteOcr?.extracted?.vat,
            ...(remoteOcr?.candidates?.amounts || []).map((candidate) => candidate.amount)
          ]
            .map((value) => normalizeAmount(value))
            .filter((value) => value != null)
            .map((value) => roundMoney(value))
        ),
        date: remoteOcr?.extracted?.date || null
      });
    }

    const pageText = await fetchRemotePageText(entry.url);
    return buildMatchDetails(entry, receiptProfile, {
      text: pageText,
      tokens: tokenizeText(pageText),
      amounts: extractAmountsFromText(pageText),
      date: null
    });
  } catch (error) {
    return {
      url: entry.url,
      kinds: entry.kinds,
      provider_score: entry.provider_score,
      score: Math.min(100, Number(entry.provider_score || 0)),
      reasons: [],
      analysis_error: error.message
    };
  }
};

const detectReceiptWebMatch = async (imagePath, expense = {}) => {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;

  // Keep the check optional. If there is no API key configured, we simply skip it.
  if (!apiKey || !imagePath) {
    return {
      provider_configured: Boolean(apiKey),
      checked: false,
      web_match_found: false,
      web_match_count: 0,
      web_match_sources: [],
      web_match_reason: null,
      best_guess_labels: []
    };
  }

  try {
    const imageBuffer = await fs.readFile(imagePath);
    const response = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: imageBuffer.toString("base64")
            },
            features: [
              {
                type: "WEB_DETECTION",
                maxResults: 10
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Vision web detection failed: ${response.status} ${errorText}`);
    }

    const payload = await response.json();
    const webDetection = payload?.responses?.[0]?.webDetection || {};
    const webMatchEntries = getWebMatchEntries(webDetection);
    const bestGuessLabels = (webDetection.bestGuessLabels || [])
      .map((label) => label.label)
      .filter(Boolean);
    const localReceiptOcr = await recognizeBestOcr(imagePath).catch(() => null);
    const receiptProfile = buildReceiptProfile(expense, localReceiptOcr || {});

    const imageEntries = webMatchEntries.filter((entry) => entry.kinds.some((kind) => kind.includes("image")));
    const pageEntries = webMatchEntries.filter((entry) => !entry.kinds.some((kind) => kind.includes("image")));
    const sourcesToAnalyze = [
      ...imageEntries.slice(0, MAX_ANALYZED_IMAGE_SOURCES),
      ...pageEntries.slice(0, Math.max(0, MAX_ANALYZED_SOURCES - MAX_ANALYZED_IMAGE_SOURCES))
    ];

    const analyzedSources = [];
    for (const entry of sourcesToAnalyze) {
      analyzedSources.push(await analyzeSourceEntry(entry, receiptProfile));
    }

    const mergedSources = getUniqueSources([
      ...analyzedSources,
      ...webMatchEntries.map((entry) => ({
        url: entry.url,
        kinds: entry.kinds,
        provider_score: entry.provider_score,
        score: entry.provider_score,
        reasons: []
      }))
    ])
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, MAX_RETURNED_SOURCES);

    const strongMatches = mergedSources.filter((source) => Number(source.score || 0) >= WEB_MATCH_SCORE_THRESHOLD);
    const directProviderMatches = mergedSources.filter((source) =>
      (source.kinds || []).some((kind) => DIRECT_PROVIDER_MATCH_KINDS.has(kind))
    );
    const bestMatch = mergedSources[0] || null;
    const hasSuspiciousWebMatch = strongMatches.length > 0 || directProviderMatches.length > 0;

    return {
      provider_configured: true,
      checked: true,
      web_match_found: hasSuspiciousWebMatch,
      web_match_count: mergedSources.length,
      web_match_sources: mergedSources,
      web_match_reason: hasSuspiciousWebMatch ? GOOGLE_VISION_REASON : null,
      best_guess_labels: bestGuessLabels,
      web_match_best_score: bestMatch ? Number(bestMatch.score || 0) : 0,
      web_match_best_reasons: bestMatch?.reasons || [],
      receipt_profile: {
        total: receiptProfile.total,
        date: receiptProfile.date,
        keywords: receiptProfile.keywords
      }
    };
  } catch (error) {
    return {
      provider_configured: true,
      checked: true,
      web_match_found: false,
      web_match_count: 0,
      web_match_sources: [],
      web_match_reason: null,
      best_guess_labels: [],
      web_match_best_score: 0,
      web_match_best_reasons: [],
      error: error.message
    };
  }
};

module.exports = {
  GOOGLE_VISION_REASON,
  WEB_MATCH_SCORE_THRESHOLD,
  detectReceiptWebMatch
};
