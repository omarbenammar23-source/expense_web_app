const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { createCanvas } = require("@napi-rs/canvas");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const db = require("../config/db");
const { detectExpenseFraud } = require("../utils/fraudDetection");

const OCR_LANGUAGES = process.env.OCR_LANGUAGES || "eng+fra";

const MONTHS = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

const MONTH_ALIASES = [...new Set(Object.keys(MONTHS))].sort((left, right) => right.length - left.length).join("|");
const TOTAL_LABEL_REGEX =
  /\b(grand\s*total|amount\s*due|net\s*payable|balance\s*due|totale\s*pagato|totale\s*documento|totale|total)\b/i;
const SUBTOTAL_LABEL_REGEX = /\b(sub\s*total|subtotal|sous\s*total|totale\s*imponibile)\b/i;
const VAT_LABEL_REGEX = /\b(vat|tax|tva|gst|iva)\b/i;
const DATE_LABEL_REGEX = /\b(date|invoice\s*date|receipt\s*date|issued|issue\s*date|billing\s*date)\b/i;
const MONTH_NAME_REGEX =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const DISCOUNT_LABEL_REGEX = /\b(discount|remise|reduction|promo|coupon|saving|savings)\b/i;
const ITEM_HEADER_REGEX = /\b(item|items|designation|description|product|service|qty|quantity|unit\s*price)\b/i;
const ITEM_STOP_LABEL_REGEX =
  /\b(total|subtotal|sub\s*total|vat|tax|tva|gst|iva|amount\s*due|balance\s*due|net\s*payable)\b/i;
const DATE_LINE_REGEX = /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/;
const AMOUNT_TOKEN_REGEX =
  /[$\u20AC\u00A3]?\s*-?(?:\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{2})|\d+[.,]\d{2}|\d+\s\d{2}|\d+)/g;
const HIGH_VALUE_AMOUNT_REGEX = /(?:[$\u20AC\u00A3]\s*)?-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})|(?:[$\u20AC\u00A3]\s*)?-?\d+\s\d{2}/;
const SMALL_DESKEW_ANGLES = [0, -1.2, 1.2];
const MIN_PDF_TEXT_LENGTH = 10;
const MAX_PDF_PAGES = 5;
const PDF_RENDER_SCALE = 3;
const CURRENCY_PATTERNS = [
  { code: "EUR", regexes: [/\u20AC/g, /\beur\b/gi, /\beuro?s?\b/gi] },
  { code: "USD", regexes: [/\$/g, /\busd\b/gi, /\bdollar?s?\b/gi, /\bus\$/gi] },
  { code: "GBP", regexes: [/\u00A3/g, /\bgbp\b/gi, /\bpound?s?\b/gi] },
  { code: "TND", regexes: [/\btnd\b/gi, /\btd\b/gi, /\bdt\b/gi, /\bdinar\b/gi] },
  { code: "MAD", regexes: [/\bmad\b/gi, /\bdh\b/gi, /\bdirham\b/gi] },
  { code: "DZD", regexes: [/\bdzd\b/gi, /\bda\b/gi, /\bdinar\b/gi] },
  { code: "CHF", regexes: [/\bchf\b/gi, /\bfrancs?\b/gi] }
];

const pad = (value) => String(value).padStart(2, "0");
const normalizeMonthName = (monthName) => MONTHS[String(monthName || "").toLowerCase().replace(/\.$/, "")] || null;

const uniqueBy = (items, getKey) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const buildIsoDate = (year, month, day) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);

  if (!numericYear || !numericMonth || !numericDay) {
    return null;
  }

  const candidate = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
  if (
    candidate.getUTCFullYear() !== numericYear ||
    candidate.getUTCMonth() !== numericMonth - 1 ||
    candidate.getUTCDate() !== numericDay
  ) {
    return null;
  }

  return `${numericYear}-${pad(numericMonth)}-${pad(numericDay)}`;
};

const normalizeYear = (year) => {
  if (year.length === 2) {
    return Number(year) >= 70 ? `19${year}` : `20${year}`;
  }

  return year;
};

const formatDateForMySQL = (dateStr) => {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  return null;
};

const normalizeAmount = (rawValue) => {
  if (!rawValue) return null;

  const trimmedRawValue = rawValue.replace(/[$\u20AC\u00A3]/g, "").trim();
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
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
};

const detectCurrencyCandidates = (text, amountCandidates = []) => {
  const normalizedText = String(text || "");
  const scores = new Map();

  const addScore = (code, points, reason) => {
    const current = scores.get(code) || { code, score: 0, reasons: [] };
    current.score += points;
    current.reasons.push(reason);
    scores.set(code, current);
  };

  CURRENCY_PATTERNS.forEach(({ code, regexes }) => {
    regexes.forEach((regex) => {
      const matches = normalizedText.match(regex) || [];
      if (matches.length) {
        addScore(code, matches.length * 25, `Text matched ${matches[0]}`);
      }
    });
  });

  amountCandidates.forEach((candidate) => {
    const raw = String(candidate.raw || "");
    const line = String(candidate.line || "");

    if (raw.includes("€")) addScore("EUR", 35, "Amount symbol €");
    if (raw.includes("$")) addScore("USD", 35, "Amount symbol $");
    if (raw.includes("£")) addScore("GBP", 35, "Amount symbol £");

    CURRENCY_PATTERNS.forEach(({ code, regexes }) => {
      regexes.forEach((regex) => {
        if (line.match(regex)) {
          addScore(code, candidate.label === "total" ? 28 : 12, `Line matched ${code}`);
        }
      });
    });
  });

  return [...scores.values()].sort((left, right) => right.score - left.score);
};

const detectCurrency = (text, amountCandidates = []) => {
  const candidates = detectCurrencyCandidates(text, amountCandidates);
  return {
    currency: candidates[0]?.score > 0 ? candidates[0].code : null,
    candidates
  };
};

const getAutomaticItemCount = (items = []) => {
  if (!items.length) {
    return 0;
  }

  const quantities = items
    .map((item) => Number(item.quantity))
    .filter((quantity) => Number.isFinite(quantity) && quantity > 0);

  if (!quantities.length) {
    return items.length;
  }

  return Math.round(quantities.reduce((sum, quantity) => sum + quantity, 0));
};

const buildCleanDescription = (line, amountTokens) => {
  let description = String(line || "");

  amountTokens.forEach((token) => {
    description = description.replace(token, " ");
  });

  return description.replace(/\s+/g, " ").replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").trim();
};

const parseLineQuantity = (description, amountCount) => {
  const quantityMatch = String(description || "").match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s+(.+)$/);

  if (!quantityMatch) {
    return {
      quantity: amountCount >= 2 ? 1 : null,
      description
    };
  }

  const quantity = Number(quantityMatch[1].replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      quantity: amountCount >= 2 ? 1 : null,
      description
    };
  }

  return {
    quantity,
    description: quantityMatch[2].trim()
  };
};

const extractBillDetails = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  const discounts = [];

  lines.forEach((line, lineIndex) => {
    const rawTokens = [...line.matchAll(AMOUNT_TOKEN_REGEX)].map((match) => match[0]);
    if (!rawTokens.length) {
      return;
    }

    const amounts = rawTokens.map((token) => normalizeAmount(token)).filter((amount) => Number.isFinite(amount));
    if (!amounts.length) {
      return;
    }

    const isDiscountLine = DISCOUNT_LABEL_REGEX.test(line) || rawTokens.some((token) => token.includes("-"));
    if (isDiscountLine) {
      const discountAmount = roundMoney(Math.max(...amounts.map((amount) => Math.abs(amount))));
      const description = buildCleanDescription(line, rawTokens) || "Discount";

      discounts.push({
        name: description,
        amount: discountAmount,
        line,
        lineIndex
      });
      return;
    }

    if (ITEM_STOP_LABEL_REGEX.test(line) || DATE_LABEL_REGEX.test(line) || ITEM_HEADER_REGEX.test(line)) {
      return;
    }

    const descriptionText = buildCleanDescription(line, rawTokens);
    if (!descriptionText || !/[a-z]/i.test(descriptionText)) {
      return;
    }

    const parsedQuantity = parseLineQuantity(descriptionText, amounts.length);
    if (!parsedQuantity.description) {
      return;
    }

    items.push({
      name: parsedQuantity.description,
      quantity: parsedQuantity.quantity,
      unit_price:
        amounts.length >= 2 ? roundMoney(amounts[amounts.length - 2]) : roundMoney(amounts[amounts.length - 1]),
      total_price: roundMoney(amounts[amounts.length - 1]),
      lineIndex
    });
  });

  const uniqueItems = uniqueBy(items, (item) => `${item.name}:${item.total_price}:${item.lineIndex}`).slice(0, 20);
  const uniqueDiscounts = uniqueBy(
    discounts,
    (discount) => `${discount.name}:${discount.amount}:${discount.lineIndex}`
  ).slice(0, 8);
  const discountAmount = uniqueDiscounts.length
    ? roundMoney(uniqueDiscounts.reduce((sum, discount) => sum + Number(discount.amount || 0), 0))
    : null;

  return {
    items: uniqueItems,
    discounts: uniqueDiscounts,
    discount_amount: discountAmount,
    item_count: getAutomaticItemCount(uniqueItems)
  };
};

const getTodayAsIsoDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const parseDateCandidates = (text) => {
  if (!text) return [];

  const candidates = [];
  const lines = text.split(/\r?\n/);
  const numericPattern = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})\b/g;
  const isoPattern = /\b(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/g;
  const dayMonthYearPattern =
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+|[./-])(${MONTH_ALIASES})(?:,)?\\s+(\\d{2}|\\d{4})\\b`, "gi");
  const monthDayYearPattern =
    new RegExp(`\\b(${MONTH_ALIASES})(?:\\s+|[./-])(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{2}|\\d{4})\\b`, "gi");

  const pushCandidate = (raw, normalized, source) => {
    const lineIndex = lines.findIndex((line) => line.includes(raw));
    const line = lineIndex >= 0 ? lines[lineIndex] : "";

    candidates.push({
      raw,
      normalized,
      source,
      line,
      lineIndex,
      hasLabel: DATE_LABEL_REGEX.test(line)
    });
  };

  for (const match of text.matchAll(numericPattern)) {
    const [, day, month, year] = match;
    const iso = buildIsoDate(normalizeYear(year), month, day);

    if (iso) {
      pushCandidate(match[0], iso, "numeric");
    }
  }

  for (const match of text.matchAll(isoPattern)) {
    const [, year, month, day] = match;
    const iso = buildIsoDate(normalizeYear(year), month, day);

    if (iso) {
      pushCandidate(match[0], iso, "iso");
    }
  }

  for (const match of text.matchAll(dayMonthYearPattern)) {
    const [, day, monthName, year] = match;
    const iso = buildIsoDate(normalizeYear(year), normalizeMonthName(monthName), day);

    if (iso) {
      pushCandidate(match[0], iso, "day-month-name");
    }
  }

  for (const match of text.matchAll(monthDayYearPattern)) {
    const [, monthName, day, year] = match;
    const iso = buildIsoDate(normalizeYear(year), normalizeMonthName(monthName), day);

    if (iso) {
      pushCandidate(match[0], iso, "month-name-day");
    }
  }

  return uniqueBy(candidates, (candidate) => `${candidate.normalized}:${candidate.raw}`).sort((left, right) => {
    const leftScore = (left.hasLabel ? 50 : 0) + (left.lineIndex >= 0 ? Math.max(0, 10 - left.lineIndex) : 0);
    const rightScore =
      (right.hasLabel ? 50 : 0) + (right.lineIndex >= 0 ? Math.max(0, 10 - right.lineIndex) : 0);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.lineIndex - right.lineIndex;
  });
};

const shouldKeepGenericAmount = (line, token, amount) => {
  if (!Number.isFinite(amount)) {
    return false;
  }

  const hasCurrency = /[$\u20AC\u00A3]/.test(token);
  const hasDecimalSeparator = /[.,]/.test(token);
  const hasSplitDecimals = /^\d+\s\d{2}$/.test(token.trim());
  const hasAmountLabel =
    TOTAL_LABEL_REGEX.test(line) || SUBTOTAL_LABEL_REGEX.test(line) || VAT_LABEL_REGEX.test(line);
  const lineWithoutToken = line.replace(token, " ").trim();
  const lineHasOtherLetters = /[a-z]/i.test(lineWithoutToken);

  if (hasCurrency || hasDecimalSeparator || hasSplitDecimals || hasAmountLabel) {
    return true;
  }

  if ((DATE_LINE_REGEX.test(line) || MONTH_NAME_REGEX.test(line)) && amount >= 1900 && amount <= 2100) {
    return false;
  }

  if (lineHasOtherLetters) {
    return false;
  }

  return amount >= 100;
};

const classifyAmountCandidate = (line) => {
  if (SUBTOTAL_LABEL_REGEX.test(line)) {
    return "subtotal";
  }

  if (VAT_LABEL_REGEX.test(line)) {
    return "vat";
  }

  if (TOTAL_LABEL_REGEX.test(line)) {
    return "total";
  }

  return "generic";
};

const getLabelMatch = (line, label) => {
  const regexByLabel = {
    total: TOTAL_LABEL_REGEX,
    subtotal: SUBTOTAL_LABEL_REGEX,
    vat: VAT_LABEL_REGEX
  };

  const regex = regexByLabel[label];
  if (!regex) {
    return null;
  }

  return line.match(regex);
};

const labelStrengthScore = (candidate) => {
  const normalizedLine = candidate.line.toLowerCase();

  if (candidate.label === "total") {
    if (/grand\s*total/.test(normalizedLine)) return 80;
    if (/amount\s*due|balance\s*due|net\s*payable/.test(normalizedLine)) return 75;
    if (/totale\s*pagato|totale\s*documento/.test(normalizedLine)) return 72;
    if (/\btotal\b|\btotale\b/.test(normalizedLine)) return 65;
  }

  if (candidate.label === "subtotal") {
    return 55;
  }

  if (candidate.label === "vat") {
    return 45;
  }

  return 0;
};

const extractAmountCandidates = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const amounts = [];

  lines.forEach((line, lineIndex) => {
    const matches = [...line.matchAll(AMOUNT_TOKEN_REGEX)];
    if (!matches.length) {
      return;
    }

    matches.forEach((match, tokenIndex) => {
      const raw = match[0];
      const amount = normalizeAmount(raw);
      const label = classifyAmountCandidate(line);
      const labelMatch = getLabelMatch(line, label);
      const tokenStart = Number(match.index || 0);
      const labelStart = labelMatch ? line.toLowerCase().indexOf(labelMatch[0].toLowerCase()) : -1;
      const labelEnd = labelStart >= 0 ? labelStart + labelMatch[0].length : -1;

      if (!shouldKeepGenericAmount(line, raw, amount)) {
        return;
      }

      amounts.push({
        raw,
        amount,
        label,
        hasCurrency: /[$\u20AC\u00A3]/.test(raw),
        line,
        lineIndex,
        tokenIndex,
        tokenStart,
        labelDistance: labelEnd >= 0 ? Math.abs(tokenStart - labelEnd) : null,
        isAfterLabel: labelEnd >= 0 ? tokenStart >= labelEnd : false
      });
    });
  });

  const totalCandidates = amounts.filter((candidate) => candidate.label === "total");
  const subtotalCandidates = amounts.filter((candidate) => candidate.label === "subtotal");
  const vatCandidates = amounts.filter((candidate) => candidate.label === "vat");
  const genericCandidates = amounts.filter((candidate) => candidate.label === "generic");

  return {
    amounts,
    totalCandidates,
    subtotalCandidates,
    vatCandidates,
    genericCandidates
  };
};

const getLargestAmount = (amounts) => {
  if (!amounts.length) {
    return null;
  }

  return amounts.reduce((largest, current) => {
    if (!largest) {
      return current;
    }

    const currentScore = getLikelyAmountScore(current, current.label);
    const largestScore = getLikelyAmountScore(largest, largest.label);

    if (currentScore > largestScore) {
      return current;
    }

    if (currentScore === largestScore && current.amount > largest.amount) {
      return current;
    }

    if (current.amount === largest.amount && current.lineIndex > largest.lineIndex) {
      return current;
    }

    return largest;
  }, null);
};

const amountFormattingScore = (candidate) => {
  if (candidate.hasCurrency) return 20;
  if (/^\d+\s\d{2}$/.test(candidate.raw.trim())) return 18;
  if (/[.,]/.test(candidate.raw)) return 15;
  if (Number.isInteger(candidate.amount) && candidate.amount >= 1000) return 0;
  return 5;
};

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

const hasSupportingAmountSum = (candidate, allCandidates) => {
  const target = roundMoney(candidate.amount);
  const uniqueAmounts = uniqueBy(
    allCandidates
      .filter((item) => item.amount < candidate.amount)
      .map((item) => roundMoney(item.amount))
      .filter((amount) => Number.isFinite(amount) && amount > 0),
    (amount) => amount
  );

  for (let index = 0; index < uniqueAmounts.length; index += 1) {
    for (let innerIndex = index; innerIndex < uniqueAmounts.length; innerIndex += 1) {
      const sum = roundMoney(uniqueAmounts[index] + uniqueAmounts[innerIndex]);

      if (Math.abs(sum - target) <= 0.05) {
        return true;
      }
    }
  }

  return false;
};

const buildDerivedTotalCandidate = (amounts, indices) => {
  const selected = indices.map((index) => amounts[index]);
  const amount = roundMoney(selected.reduce((sum, item) => sum + item, 0));

  return {
    raw: selected.join(" + "),
    amount,
    label: "derived-total",
    hasCurrency: false,
    line: "Derived from amount breakdown",
    lineIndex: Number.MAX_SAFE_INTEGER,
    tokenIndex: Number.MAX_SAFE_INTEGER,
    tokenStart: Number.MAX_SAFE_INTEGER,
    labelDistance: 0,
    isAfterLabel: true,
    derived: true,
    supportingAmounts: selected
  };
};

const findDerivedTotalCandidate = (allCandidates) => {
  const uniqueAmounts = uniqueBy(
    allCandidates
      .map((candidate) => roundMoney(candidate.amount))
      .filter((amount) => Number.isFinite(amount) && amount > 0),
    (amount) => amount
  )
    .sort((left, right) => right - left)
    .slice(0, 12);

  let bestCandidate = null;

  const search = (startIndex, pickedIndices, runningTotal) => {
    if (pickedIndices.length >= 2) {
      const candidate = buildDerivedTotalCandidate(uniqueAmounts, pickedIndices);

      if (
        !bestCandidate ||
        candidate.amount > bestCandidate.amount ||
        (candidate.amount === bestCandidate.amount &&
          candidate.supportingAmounts.length < bestCandidate.supportingAmounts.length)
      ) {
        bestCandidate = candidate;
      }
    }

    if (pickedIndices.length === 4) {
      return;
    }

    for (let index = startIndex; index < uniqueAmounts.length; index += 1) {
      const nextTotal = roundMoney(runningTotal + uniqueAmounts[index]);

      if (nextTotal > 100000) {
        continue;
      }

      search(index + 1, [...pickedIndices, index], nextTotal);
    }
  };

  search(0, [], 0);

  return bestCandidate;
};

const getLikelyAmountScore = (candidate, field) => {
  const amount = Number(candidate.amount || 0);
  let score = amountFormattingScore(candidate) + labelStrengthScore(candidate);

  if (candidate.lineIndex >= 0) {
    score += Math.min(15, candidate.lineIndex);
  }

  if (amount >= 0) {
    score += 4;
  }

  if (field === "total") {
    if (candidate.label === "total") {
      score += 130;
    }

    if (candidate.isAfterLabel) {
      score += 20;
    }

    if (candidate.labelDistance != null) {
      score += Math.max(0, 25 - candidate.labelDistance);
    }

    if (candidate.region === "totals") {
      score += 30;
    }

    if (HIGH_VALUE_AMOUNT_REGEX.test(candidate.raw)) {
      score += 12;
    }

    if (amount >= 10) {
      score += 8;
    }
  }

  return score + Math.min(10, Number(candidate.confidence || 0) / 10);
};

const getTotalCandidateScore = (candidate, allCandidates) => {
  let score = getLikelyAmountScore(candidate, "total");

  if (candidate.derived) {
    score += 90 + Math.min(20, (candidate.supportingAmounts || []).length * 5);
  }

  if (hasSupportingAmountSum(candidate, allCandidates)) {
    score += 80;
  }

  const largerAmounts = allCandidates.filter((item) => item.amount > candidate.amount);
  if (candidate.label !== "total" && largerAmounts.length >= 2) {
    score -= 20;
  }

  return score;
};

const chooseBestResolvedTotal = (labeledCandidate, fallbackCandidate, derivedCandidate, allCandidates) => {
  const candidates = [labeledCandidate, fallbackCandidate, derivedCandidate].filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  const sorted = candidates.sort((left, right) => {
    const leftScore = getTotalCandidateScore(left, allCandidates);
    const rightScore = getTotalCandidateScore(right, allCandidates);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return right.amount - left.amount;
  });

  return sorted[0];
};

const extractData = (text) => {
  const dateCandidates = parseDateCandidates(text);
  const { amounts, totalCandidates, subtotalCandidates, vatCandidates, genericCandidates } =
    extractAmountCandidates(text);
  const currencyResult = detectCurrency(text, amounts);
  const billDetails = extractBillDetails(text);

  const subtotal = getLargestAmount(subtotalCandidates);
  const vat = getLargestAmount(vatCandidates);
  const labeledTotal = getLargestAmount(totalCandidates);
  const fallbackTotal = getLargestAmount(genericCandidates.length ? genericCandidates : amounts);
  const total = labeledTotal || fallbackTotal;

  return {
    extracted: {
      date: dateCandidates[0] ? dateCandidates[0].normalized : null,
      subtotal: subtotal ? subtotal.amount : null,
      vat: vat ? vat.amount : null,
      total: total ? total.amount : null,
      currency: currencyResult.currency,
      discount: billDetails.discount_amount,
      items: billDetails.items,
      item_count: billDetails.item_count
    },
    candidates: {
      dates: dateCandidates,
      totals: totalCandidates,
      subtotals: subtotalCandidates,
      vat: vatCandidates,
      amounts,
      currencies: currencyResult.candidates,
      discounts: billDetails.discounts
    }
  };
};

const buildProcessedRegionPipeline = async (imageInput, { mode, region = "full", angle = 0 }) => {
  const metadata = await sharp(imageInput).rotate().metadata();
  const pipeline = sharp(imageInput)
    .rotate()
    .grayscale()
    .normalize()
    .linear(1.2, -(128 * 1.2) + 128);

  if (angle) {
    pipeline.rotate(angle, { background: { r: 255, g: 255, b: 255, alpha: 1 } });
  }

  if (region === "totals") {
    const left = Math.max(0, Math.round(metadata.width * 0.45));
    const top = Math.max(0, Math.round(metadata.height * 0.68));
    const width = Math.max(1, metadata.width - left);
    const height = Math.max(1, metadata.height - top);
    pipeline.extract({ left, top, width, height });
  }

  pipeline
    .resize({ width: region === "totals" ? 2200 : 2400, withoutEnlargement: true, fit: "inside" })
    .sharpen({ sigma: 1.2, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 });

  if (mode === "threshold") {
    pipeline.threshold(168);
  }

  return pipeline.png().toBuffer();
};

const buildFullSharpPipeline = (imageInput, mode, angle = 0) =>
  buildProcessedRegionPipeline(imageInput, { mode, region: "full", angle });

const buildTotalsSharpPipeline = (imageInput, mode, angle = 0) =>
  buildProcessedRegionPipeline(imageInput, { mode, region: "totals", angle });

const buildImageVariants = async (imageInput) => {
  const variants = [];

  const builders = [
    {
      name: "original-safe",
      region: "full",
      build: () => sharp(imageInput).rotate().png().toBuffer()
    },
    { name: "grayscale", region: "full", build: () => buildFullSharpPipeline(imageInput, "grayscale") },
    { name: "threshold", region: "full", build: () => buildFullSharpPipeline(imageInput, "threshold") },
    {
      name: "totals-grayscale",
      region: "totals",
      build: () => buildTotalsSharpPipeline(imageInput, "grayscale")
    },
    {
      name: "totals-threshold",
      region: "totals",
      build: () => buildTotalsSharpPipeline(imageInput, "threshold")
    }
  ];

  SMALL_DESKEW_ANGLES.filter((angle) => angle !== 0).forEach((angle) => {
    const angleLabel = String(angle).replace("-", "neg-").replace(".", "_");
    builders.push({
      name: `threshold-deskew-${angleLabel}`,
      region: "full",
      build: () => buildFullSharpPipeline(imageInput, "threshold", angle)
    });
    builders.push({
      name: `totals-threshold-deskew-${angleLabel}`,
      region: "totals",
      build: () => buildTotalsSharpPipeline(imageInput, "threshold", angle)
    });
  });

  for (const builder of builders) {
    try {
      variants.push({
        name: builder.name,
        region: builder.region,
        input: await builder.build()
      });
    } catch (error) {
      variants.push({
        name: `${builder.name}-skipped`,
        region: builder.region,
        skipped: true,
        reason: error.message
      });
    }
  }

  return variants;
};

const scoreAttempt = (result) => {
  const { extracted, candidates, confidence, region } = result;

  return (
    (extracted.total != null ? 40 : 0) +
    (candidates.totals.length ? 25 : 0) +
    (region === "totals" && extracted.total != null ? 20 : 0) +
    (extracted.date ? 15 : 0) +
    (extracted.subtotal != null ? 5 : 0) +
    (extracted.vat != null ? 5 : 0) +
    Math.min(10, Number(confidence || 0) / 10) +
    Math.min(10, candidates.amounts.length)
  );
};

const enrichAmountCandidate = (candidate, attempt) => ({
  ...candidate,
  variant: attempt.variant,
  region: attempt.region,
  confidence: attempt.confidence
});

const chooseBestCandidate = (candidates, field) => {
  if (!candidates.length) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftScore = getLikelyAmountScore(left, field);
    const rightScore = getLikelyAmountScore(right, field);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    if (right.amount !== left.amount) {
      return right.amount - left.amount;
    }

    return right.lineIndex - left.lineIndex;
  });

  return sorted[0];
};

const chooseBestTotalCandidate = (candidates, allCandidates) => {
  if (!candidates.length) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const leftScore = getTotalCandidateScore(left, allCandidates);
    const rightScore = getTotalCandidateScore(right, allCandidates);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    if (right.amount !== left.amount) {
      return right.amount - left.amount;
    }

    return right.lineIndex - left.lineIndex;
  });

  return sorted[0];
};

const mergeCandidatesFromAttempts = (attempts) => {
  const mergedDates = [];
  const mergedTotals = [];
  const mergedSubtotals = [];
  const mergedVat = [];
  const mergedAmounts = [];

  attempts.forEach((attempt) => {
    attempt.candidates.dates.forEach((candidate) => {
      mergedDates.push({
        ...candidate,
        variant: attempt.variant,
        region: attempt.region,
        confidence: attempt.confidence
      });
    });

    attempt.candidates.totals.forEach((candidate) => mergedTotals.push(enrichAmountCandidate(candidate, attempt)));
    attempt.candidates.subtotals.forEach((candidate) =>
      mergedSubtotals.push(enrichAmountCandidate(candidate, attempt))
    );
    attempt.candidates.vat.forEach((candidate) => mergedVat.push(enrichAmountCandidate(candidate, attempt)));
    attempt.candidates.amounts.forEach((candidate) => mergedAmounts.push(enrichAmountCandidate(candidate, attempt)));
  });

  return {
    dates: uniqueBy(mergedDates, (candidate) => `${candidate.normalized}:${candidate.variant}`),
    totals: uniqueBy(mergedTotals, (candidate) => `${candidate.raw}:${candidate.amount}:${candidate.variant}`),
    subtotals: uniqueBy(
      mergedSubtotals,
      (candidate) => `${candidate.raw}:${candidate.amount}:${candidate.variant}`
    ),
    vat: uniqueBy(mergedVat, (candidate) => `${candidate.raw}:${candidate.amount}:${candidate.variant}`),
    amounts: uniqueBy(mergedAmounts, (candidate) => `${candidate.raw}:${candidate.amount}:${candidate.variant}`)
  };
};

let pdfJsModulePromise = null;

const getPdfJsModule = async () => {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  return pdfJsModulePromise;
};

const getPdfStandardFontDataUrl = () =>
  `${pathToFileURL(path.join(__dirname, "..", "node_modules", "pdfjs-dist", "standard_fonts")).href}/`;

const loadPdfDocument = async (filePath) => {
  const pdfjs = await getPdfJsModule();
  const data = await fs.promises.readFile(filePath);

  return pdfjs.getDocument({
    data: new Uint8Array(data),
    disableWorker: true,
    standardFontDataUrl: getPdfStandardFontDataUrl()
  }).promise;
};

const isPdfFile = (file = {}) => {
  const extension = path.extname(file.originalname || file.filename || file.path || "").toLowerCase();
  return extension === ".pdf" || file.mimetype === "application/pdf";
};

const buildPdfPageText = (items = []) => {
  const textItems = items
    .map((item) => ({
      text: String(item.str || "").trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0)
    }))
    .filter((item) => item.text);

  if (!textItems.length) {
    return "";
  }

  const rows = [];
  const yTolerance = 3;

  textItems.forEach((item) => {
    const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= yTolerance);
    if (existingRow) {
      existingRow.items.push(item);
      existingRow.y = (existingRow.y + item.y) / 2;
      return;
    }

    rows.push({
      y: item.y,
      items: [item]
    });
  });

  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) =>
      row.items
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
    .trim();
};

const hasExtractablePdfText = (text) => {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (normalizedText.length < MIN_PDF_TEXT_LENGTH) {
    return false;
  }

  return /[a-z]{2,}|\d{2,}|[$\u20AC\u00A3]/i.test(normalizedText);
};

const extractPdfTextContent = async (filePath) => {
  const document = await loadPdfDocument(filePath);
  const pagesToProcess = Math.min(document.numPages || 0, MAX_PDF_PAGES);
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
      const text = buildPdfPageText(textContent.items);

    if (text) {
      pageTexts.push(text);
    }
  }

  return {
    text: pageTexts.join("\n").trim(),
    pagesProcessed: pagesToProcess,
    totalPages: document.numPages || pagesToProcess
  };
};

const renderPdfPagesToImages = async (filePath) => {
  const document = await loadPdfDocument(filePath);
  const pagesToProcess = Math.min(document.numPages || 0, MAX_PDF_PAGES);
  const renderedPages = [];

  for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const pngBuffer = await canvas.encode("png");
    renderedPages.push({
      pageNumber,
      buffer: Buffer.from(pngBuffer)
    });
  }

  return {
    pages: renderedPages,
    pagesProcessed: pagesToProcess,
    totalPages: document.numPages || pagesToProcess
  };
};

const choosePdfFieldValue = (combinedValue, pageValue) => {
  if (combinedValue === undefined || combinedValue === null || combinedValue === "") {
    return pageValue ?? null;
  }

  return combinedValue;
};

const hasUsefulExtractedReceiptData = (extracted = {}) =>
  extracted.total != null ||
  extracted.subtotal != null ||
  extracted.vat != null ||
  Boolean(extracted.date) ||
  Boolean(extracted.currency) ||
  (Array.isArray(extracted.items) && extracted.items.length > 0);

const recognizePdfReceipt = async (filePath) => {
  const pdfTextResult = await extractPdfTextContent(filePath);
  const pdfTextExtraction = hasExtractablePdfText(pdfTextResult.text) ? extractData(pdfTextResult.text) : null;

  if (pdfTextExtraction && hasUsefulExtractedReceiptData(pdfTextExtraction.extracted)) {
    return {
      text: pdfTextResult.text,
      extracted: pdfTextExtraction.extracted,
      candidates: pdfTextExtraction.candidates,
      ocr: {
        variant: "pdf-text",
        confidence: 100,
        attempts: [
          {
            variant: "pdf-text",
            region: "document",
            confidence: 100,
            skipped: false,
            score: 100,
            reason: null,
            pages_processed: pdfTextResult.pagesProcessed,
            total_pages: pdfTextResult.totalPages
          }
        ]
      }
    };
  }

  const renderedPdf = await renderPdfPagesToImages(filePath);
  if (!renderedPdf.pages.length) {
    throw new Error("PDF did not contain any pages that could be processed");
  }

  const pageResults = [];
  for (const renderedPage of renderedPdf.pages) {
    const pageOcrResult = await recognizeBestOcr(renderedPage.buffer);
    pageResults.push({
      ...pageOcrResult,
      pageNumber: renderedPage.pageNumber
    });
  }

  const combinedText = uniqueBy(
    [
      String(pdfTextResult.text || "").trim(),
      ...pageResults.map((result) => String(result.text || "").trim())
    ].filter(Boolean),
    (value) => value
  ).join("\n");
  const combinedExtraction = combinedText ? extractData(combinedText) : { extracted: {}, candidates: {} };
  const bestPageResult =
    pageResults.find((result) => result.extracted.total != null || result.extracted.date || result.text) || pageResults[0];
  const flattenedAttempts = pageResults.flatMap((result) =>
    (result.ocr?.attempts || []).map((attempt) => ({
      ...attempt,
      page: result.pageNumber
    }))
  );
  const averageConfidence =
    pageResults.reduce((sum, result) => sum + Number(result.ocr?.confidence || 0), 0) / pageResults.length;

  return {
    text: combinedText || bestPageResult.text,
    extracted: {
      date: choosePdfFieldValue(combinedExtraction.extracted?.date, bestPageResult.extracted.date),
      subtotal: choosePdfFieldValue(combinedExtraction.extracted?.subtotal, bestPageResult.extracted.subtotal),
      vat: choosePdfFieldValue(combinedExtraction.extracted?.vat, bestPageResult.extracted.vat),
      total: choosePdfFieldValue(combinedExtraction.extracted?.total, bestPageResult.extracted.total),
      currency: choosePdfFieldValue(combinedExtraction.extracted?.currency, bestPageResult.extracted.currency),
      discount: choosePdfFieldValue(combinedExtraction.extracted?.discount, bestPageResult.extracted.discount),
      items:
        combinedExtraction.extracted?.items && combinedExtraction.extracted.items.length
          ? combinedExtraction.extracted.items
          : bestPageResult.extracted.items,
      item_count: choosePdfFieldValue(combinedExtraction.extracted?.item_count, bestPageResult.extracted.item_count)
    },
    candidates:
      combinedExtraction.candidates && Object.keys(combinedExtraction.candidates).length
        ? combinedExtraction.candidates
        : bestPageResult.candidates,
    ocr: {
      variant: "pdf-ocr",
      confidence: Number.isFinite(averageConfidence) ? averageConfidence : 0,
      attempts: flattenedAttempts.length
        ? flattenedAttempts
        : [
            {
              variant: "pdf-ocr",
              region: "document",
              confidence: 0,
              skipped: false,
              score: 0,
              reason: null
            }
          ],
      pages_processed: renderedPdf.pagesProcessed,
      total_pages: renderedPdf.totalPages
    }
  };
};

const receiptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    raw_text: { type: "string" },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    subtotal: { anyOf: [{ type: "number" }, { type: "null" }] },
    vat: { anyOf: [{ type: "number" }, { type: "null" }] },
    total: { anyOf: [{ type: "number" }, { type: "null" }] },
    currency: { anyOf: [{ type: "string" }, { type: "null" }] },
    discount: { anyOf: [{ type: "number" }, { type: "null" }] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          quantity: { anyOf: [{ type: "number" }, { type: "null" }] },
          unit_price: { anyOf: [{ type: "number" }, { type: "null" }] },
          total: { anyOf: [{ type: "number" }, { type: "null" }] }
        },
        required: ["description", "quantity", "unit_price", "total"]
      }
    },
    confidence: { type: "number" }
  },
  required: ["raw_text", "date", "subtotal", "vat", "total", "currency", "discount", "items", "confidence"]
};

const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

const buildGptCandidates = (extracted) => {
  const confidence = Math.max(0, Math.min(100, Number(extracted.confidence) || 0));
  const amountCandidate = (amount, label) =>
    amount == null
      ? []
      : [{ raw: String(amount), amount, label, score: confidence, source: "gpt-vision" }];
  const dateCandidate =
    extracted.date && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)
      ? [{ raw: extracted.date, normalized: extracted.date, score: confidence, source: "gpt-vision" }]
      : [];

  return {
    dates: dateCandidate,
    subtotals: amountCandidate(extracted.subtotal, "subtotal"),
    vat: amountCandidate(extracted.vat, "vat"),
    totals: amountCandidate(extracted.total, "total"),
    amounts: [
      ...amountCandidate(extracted.subtotal, "subtotal"),
      ...amountCandidate(extracted.vat, "vat"),
      ...amountCandidate(extracted.total, "total")
    ],
    currencies: extracted.currency ? [{ code: extracted.currency, score: confidence, source: "gpt-vision" }] : [],
    discounts: amountCandidate(extracted.discount, "discount")
  };
};

const recognizePaidGptOcr = async (imageInput) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to scan receipts with GPT vision OCR");
  }

  const imageBuffer = Buffer.isBuffer(imageInput) ? imageInput : await fs.promises.readFile(imageInput);
  const normalizedImage = await sharp(imageBuffer).rotate().jpeg({ quality: 95 }).toBuffer();
  const imageUrl = `data:image/jpeg;base64,${normalizedImage.toString("base64")}`;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: OCR_MODEL,
    instructions:
      "Extract data from this expense receipt. Return only data visible on the receipt. Use ISO date format YYYY-MM-DD. Use ISO 4217 currency codes when identifiable. Use null for uncertain values, never guess. Include every readable line item and preserve the full readable receipt text.",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "Read this receipt and return its structured OCR result." },
          { type: "input_image", image_url: imageUrl, detail: "high" }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "receipt_ocr",
        strict: true,
        schema: receiptSchema
      }
    }
  });

  let result;
  try {
    result = JSON.parse(response.output_text);
  } catch {
    throw new Error("GPT vision returned an unreadable receipt result");
  }

  const extracted = {
    date: result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : null,
    subtotal: numberOrNull(result.subtotal),
    vat: numberOrNull(result.vat),
    total: numberOrNull(result.total),
    currency: result.currency ? String(result.currency).trim().toUpperCase() : null,
    discount: numberOrNull(result.discount),
    items: Array.isArray(result.items) ? result.items : [],
    item_count: getAutomaticItemCount(result.items || [])
  };
  const confidence = Math.max(0, Math.min(100, Number(result.confidence) || 0));

  return {
    text: String(result.raw_text || "").trim(),
    extracted,
    candidates: buildGptCandidates({ ...extracted, confidence }),
    ocr: {
      variant: OCR_MODEL,
      confidence,
      attempts: [
        {
          variant: OCR_MODEL,
          region: "receipt",
          confidence,
          skipped: false,
          score: confidence,
          reason: null
        }
      ]
    }
  };
};

const recognizeBestOcr = async (imageInput) => {
  const variants = await buildImageVariants(imageInput);
  const attempted = [];

  for (const variant of variants) {
    if (variant.skipped) {
      attempted.push({
        variant: variant.name,
        region: variant.region,
        confidence: 0,
        skipped: true,
        reason: variant.reason
      });
      continue;
    }

    try {
      const ocrResult = await Tesseract.recognize(variant.input, OCR_LANGUAGES);
      const text = ocrResult.data.text || "";
      const extractionResult = extractData(text);
      const enrichedResult = {
        variant: variant.name,
        region: variant.region,
        text,
        confidence: Number(ocrResult.data.confidence || 0),
        ...extractionResult
      };

      enrichedResult.score = scoreAttempt(enrichedResult);
      attempted.push(enrichedResult);
    } catch (error) {
      attempted.push({
        variant: variant.name,
        region: variant.region,
        confidence: 0,
        skipped: true,
        reason: error.message || "OCR variant failed"
      });
    }
  }

  const successfulResults = attempted.filter((result) => !result.skipped);
  if (!successfulResults.length) {
    throw new Error("OCR could not process the uploaded image");
  }

  successfulResults.sort((left, right) => right.score - left.score);
  const bestTextAttempt = successfulResults[0];
  const bestFullTextAttempt = successfulResults.find((result) => result.region === "full") || bestTextAttempt;
  const combinedText = uniqueBy(
    successfulResults.map((result) => String(result.text || "").trim()).filter(Boolean),
    (value) => value
  ).join("\n");
  const mergedCandidates = mergeCandidatesFromAttempts(successfulResults);
  const combinedExtraction = combinedText ? extractData(combinedText) : { extracted: {}, candidates: { amounts: [] } };
  const bestDateCandidate = mergedCandidates.dates[0] || null;
  const bestSubtotalCandidate = chooseBestCandidate(mergedCandidates.subtotals, "subtotal");
  const bestVatCandidate = chooseBestCandidate(mergedCandidates.vat, "vat");
  const labeledTotalCandidate = chooseBestTotalCandidate(mergedCandidates.totals, mergedCandidates.amounts);
  const fallbackTotalCandidate = chooseBestTotalCandidate(
    mergedCandidates.amounts.filter((candidate) => candidate.label === "generic" && candidate.amount >= 0),
    mergedCandidates.amounts
  );
  const derivedTotalCandidate = findDerivedTotalCandidate(mergedCandidates.amounts);

  if (derivedTotalCandidate) {
    mergedCandidates.totals = uniqueBy(
      [...mergedCandidates.totals, derivedTotalCandidate],
      (candidate) => [candidate.raw, candidate.amount, candidate.variant || "derived"].join(":")
    );
    mergedCandidates.amounts = uniqueBy(
      [...mergedCandidates.amounts, derivedTotalCandidate],
      (candidate) => [candidate.raw, candidate.amount, candidate.variant || "derived"].join(":")
    );
  }

  const bestTotalCandidate = chooseBestResolvedTotal(
    labeledTotalCandidate,
    fallbackTotalCandidate,
    derivedTotalCandidate,
    mergedCandidates.amounts
  );
  const combinedLabeledTotalCandidate = chooseBestTotalCandidate(
    combinedExtraction.candidates.totals || [],
    combinedExtraction.candidates.amounts || []
  );
  const combinedFallbackTotalCandidate = chooseBestTotalCandidate(
    (combinedExtraction.candidates.amounts || []).filter(
      (candidate) => candidate.label === "generic" && candidate.amount >= 0
    ),
    combinedExtraction.candidates.amounts || []
  );
  const combinedDerivedTotalCandidate = findDerivedTotalCandidate(combinedExtraction.candidates.amounts || []);
  const fallbackResolvedTotal = chooseBestResolvedTotal(
    combinedLabeledTotalCandidate,
    combinedFallbackTotalCandidate,
    combinedDerivedTotalCandidate,
    combinedExtraction.candidates.amounts || []
  );
  const currencyResult = detectCurrency(combinedText || bestTextAttempt.text, mergedCandidates.amounts);
  const billDetails = extractBillDetails(combinedText || bestTextAttempt.text);

  return {
    text: bestFullTextAttempt.text || combinedText || bestTextAttempt.text,
    extracted: {
      date: bestDateCandidate ? bestDateCandidate.normalized : combinedExtraction.extracted.date || null,
      subtotal: bestSubtotalCandidate ? bestSubtotalCandidate.amount : combinedExtraction.extracted.subtotal ?? null,
      vat: bestVatCandidate ? bestVatCandidate.amount : combinedExtraction.extracted.vat ?? null,
      total: bestTotalCandidate ? bestTotalCandidate.amount : fallbackResolvedTotal?.amount ?? null,
      currency: currencyResult.currency,
      discount: billDetails.discount_amount,
      items: billDetails.items,
      item_count: billDetails.item_count
    },
    candidates: {
      ...mergedCandidates,
      currencies: currencyResult.candidates,
      discounts: billDetails.discounts
    },
    ocr: {
      variant: "tesseract-local",
      confidence: bestTextAttempt.confidence,
      attempts: attempted.map((result) => ({
        variant: result.variant,
        region: result.region || "full",
        confidence: result.confidence,
        skipped: Boolean(result.skipped),
        score: result.score || 0,
        reason: result.reason || null
      }))
    }
  };
};

const scanReceipt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const receiptPath = req.file.path;
    const ocrResult = isPdfFile(req.file) ? await recognizePdfReceipt(receiptPath) : await recognizeBestOcr(receiptPath);
    res.json({
      message: "OCR completed",
      extracted: ocrResult.extracted,
      text: ocrResult.text,
      candidates: ocrResult.candidates,
      ocr: ocrResult.ocr,
      receipt_url: req.file.filename
    });
  } catch (error) {
    res.status(500).json({
      message: "OCR failed",
      error: error.message
    });
  }
};

const scanAndSaveReceipt = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const user_id = req.user.id;
    const group_id = req.group.id;
    const receiptPath = req.file.path;
    const receipt_url = req.file.filename;

    const ocrResult = isPdfFile(req.file) ? await recognizePdfReceipt(receiptPath) : await recognizeBestOcr(receiptPath);
    const mysqlDate = formatDateForMySQL(ocrResult.extracted.date) || getTodayAsIsoDate();
    const amountToSave = ocrResult.extracted.total != null ? ocrResult.extracted.total : 0;
    const currencyToSave = ocrResult.extracted.currency || null;
    const billItemsToSave = Array.isArray(ocrResult.extracted.items) ? ocrResult.extracted.items : [];
    const discountToSave = ocrResult.extracted.discount != null ? ocrResult.extracted.discount : null;
    const autoItemCount = true;
    const itemCountToSave = Number(ocrResult.extracted.item_count || 0);
    const internalFraudCheck = await detectExpenseFraud({
      user_id,
      group_id,
      amount: amountToSave,
      expense_date: mysqlDate
    });
    const suspiciousReasons = [...internalFraudCheck.suspicious_reasons];
    const isSuspicious = suspiciousReasons.length > 0;
    const fraudReason = suspiciousReasons.join("; ") || null;

    const sql = `
      INSERT INTO expenses (
        user_id,
        group_id,
        title,
        amount,
        currency,
        category,
        expense_date,
        bill_items,
        discount_amount,
        item_count,
        auto_item_count,
        receipt_url,
        status,
        is_suspicious,
        fraud_reason,
        web_match_found,
        web_match_count,
        web_match_sources,
        web_match_checked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
      sql,
      [
        user_id,
        group_id,
        "OCR Expense",
        amountToSave,
        currencyToSave,
        "Other",
        mysqlDate,
        JSON.stringify(billItemsToSave),
        discountToSave,
        itemCountToSave,
        autoItemCount,
        receipt_url,
        "pending",
        isSuspicious,
        fraudReason,
        false,
        0,
        JSON.stringify([]),
        null
      ],
      (err, resultDb) => {
        if (err) {
          return res.status(500).json({
            message: "Database save failed",
            error: err.message
          });
        }

        res.status(201).json({
          message: "Receipt scanned and expense saved successfully",
          expenseId: resultDb.insertId,
          extracted: ocrResult.extracted,
          text: ocrResult.text,
          candidates: ocrResult.candidates,
          ocr: ocrResult.ocr,
          is_suspicious: isSuspicious,
          suspicious_reason: fraudReason,
          suspicious_reasons: suspiciousReasons,
          web_match_found: false,
          web_match_count: 0,
          web_match_sources: [],
          web_match_checked_at: null
        });
      }
    );
  } catch (error) {
    res.status(500).json({
      message: "OCR save failed",
      error: error.message
    });
  }
};

module.exports = { scanReceipt, scanAndSaveReceipt, recognizeBestOcr };
