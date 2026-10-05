const db = require("../config/db");
const path = require("path");
const { detectExpenseFraud, runQuery } = require("../utils/fraudDetection");
const { detectReceiptWebMatch, GOOGLE_VISION_REASON } = require("../utils/webMatchDetection");
const { hasExpenseColumn } = require("../utils/expenseSchema");

const parseJsonArray = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};

const normalizeWebMatchSource = (source) => {
  if (!source) {
    return null;
  }

  if (typeof source === "string") {
    return {
      url: source,
      kinds: ["legacy-source"],
      provider_score: 0,
      score: 0,
      reasons: []
    };
  }

  return {
    url: source.url || null,
    kinds: Array.isArray(source.kinds) ? source.kinds : [],
    provider_score: Number(source.provider_score || 0),
    score: Number(source.score || 0),
    reasons: Array.isArray(source.reasons) ? source.reasons : [],
    matched_amounts: Array.isArray(source.matched_amounts) ? source.matched_amounts : [],
    matched_date: source.matched_date || null,
    analysis_error: source.analysis_error || null
  };
};

const parseWebMatchSources = (value) => parseJsonArray(value).map(normalizeWebMatchSource).filter(Boolean);

const normalizeBillItem = (item) => ({
  name: item?.name || "",
  quantity: item?.quantity != null && item?.quantity !== "" ? Number(item.quantity) : null,
  unit_price: item?.unit_price != null && item?.unit_price !== "" ? Number(item.unit_price) : null,
  total_price: item?.total_price != null && item?.total_price !== "" ? Number(item.total_price) : null
});

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

const normalizeExpenseRecord = (expense) => {
  const webMatchSources = parseWebMatchSources(expense.web_match_sources).sort(
    (left, right) => Number(right.score || 0) - Number(left.score || 0)
  );
  const topWebMatch = webMatchSources[0] || null;
  const billItems = parseJsonArray(expense.bill_items).map(normalizeBillItem);
  const autoItemCount = expense.auto_item_count == null ? true : Boolean(expense.auto_item_count);
  const itemCount =
    expense.item_count != null && expense.item_count !== ""
      ? Number(expense.item_count)
      : autoItemCount
        ? getAutomaticItemCount(billItems)
        : 0;

  return {
    ...expense,
    note: String(expense.note || "").trim() || null,
    note_attachment_url: expense.note_attachment_url || null,
    refunded_amount:
      expense.refunded_amount != null && expense.refunded_amount !== ""
        ? Number(expense.refunded_amount)
        : null,
    refund_currency: expense.refund_currency || null,
    refundedAmount:
      expense.refunded_amount != null && expense.refunded_amount !== ""
        ? Number(expense.refunded_amount)
        : null,
    refundCurrency: expense.refund_currency || null,
    is_suspicious: Boolean(expense.is_suspicious),
    web_match_found: Boolean(expense.web_match_found),
    web_match_count: Number(expense.web_match_count || 0),
    web_match_sources: webMatchSources,
    web_match_best_score: topWebMatch ? Number(topWebMatch.score || 0) : 0,
    web_match_best_reasons: topWebMatch?.reasons || [],
    bill_items: billItems,
    discount_amount:
      expense.discount_amount != null && expense.discount_amount !== ""
        ? Number(expense.discount_amount)
        : null,
    item_count: itemCount,
    auto_item_count: autoItemCount,
    suspicious_reason: expense.fraud_reason || null
  };
};

const parseFraudReasons = (fraudReason) =>
  String(fraudReason || "")
    .split(";")
    .map((reason) => reason.trim())
    .filter(Boolean);

const buildFraudReason = (reasons) => {
  const uniqueReasons = [...new Set(reasons.filter(Boolean))];
  return uniqueReasons.length ? uniqueReasons.join("; ") : null;
};

const canReviewGroupExpenses = (req) =>
  req.user?.role === "admin" || ["owner", "responsable", "supervisor"].includes(req.groupMembership?.role);

const normalizeRefundPayload = (body = {}, currentExpense = {}) => {
  const rawRefundedAmount =
    body.refundedAmount ?? body.refunded_amount ?? currentExpense.refunded_amount ?? null;
  const rawRefundCurrency =
    body.refundCurrency ?? body.refund_currency ?? currentExpense.refund_currency ?? null;

  const hasRefundedAmountField = body.refundedAmount !== undefined || body.refunded_amount !== undefined;
  const hasRefundCurrencyField = body.refundCurrency !== undefined || body.refund_currency !== undefined;

  let refundedAmount =
    rawRefundedAmount === "" || rawRefundedAmount == null ? null : Number(rawRefundedAmount);
  let refundCurrency = rawRefundCurrency == null ? null : String(rawRefundCurrency).trim().toUpperCase() || null;

  if (hasRefundedAmountField && refundedAmount != null && (!Number.isFinite(refundedAmount) || refundedAmount < 0)) {
    return {
      error: "Refund amount must be a number greater than or equal to 0"
    };
  }

  if (hasRefundCurrencyField && refundCurrency && refundCurrency.length > 8) {
    return {
      error: "Refund currency must be 8 characters or fewer"
    };
  }

  if (refundedAmount != null && !refundCurrency) {
    return {
      error: "Refund currency is required when a refund amount is entered"
    };
  }

  if (refundedAmount == null && refundCurrency && hasRefundCurrencyField) {
    return {
      error: "Refund amount is required when a refund currency is entered"
    };
  }

  return {
    refundedAmount,
    refundCurrency
  };
};

const ensureExpenseAccess = (expense, req) => {
  if (!expense) {
    return { allowed: false, status: 404, message: "Expense not found" };
  }

  if (req.group && Number(expense.group_id) !== Number(req.group.id)) {
    return { allowed: false, status: 404, message: "Expense not found" };
  }

  if (canReviewGroupExpenses(req)) {
    return { allowed: true };
  }

  if (Number(expense.user_id) !== Number(req.user.id)) {
    return { allowed: false, status: 403, message: "You do not have permission to access this expense" };
  }

  return { allowed: true };
};

const createExpense = async (req, res) => {
  const {
    title,
    amount,
    currency,
    category,
    expense_date,
    receipt_url: bodyReceiptUrl,
    note,
    bill_items: rawBillItems,
    discount_amount,
    item_count,
    auto_item_count
  } = req.body || {};
  const user_id = req.user.id;
  const group_id = req.group.id;
  const receipt_url = req.files?.receipt?.[0]?.filename || bodyReceiptUrl || null;
  const noteAttachmentUrl = req.files?.note_attachment?.[0]?.filename || null;

  if (!title || !amount || !category || !expense_date) {
    return res.status(400).json({
      message: "Title, amount, category and expense_date are required"
    });
  }

  try {
    const supportsNote = await hasExpenseColumn("note");
    const supportsNoteAttachment = await hasExpenseColumn("note_attachment_url");
    const internalFraudCheck = await detectExpenseFraud({
      user_id,
      group_id,
      amount,
      expense_date
    });
    const suspiciousReasons = [...internalFraudCheck.suspicious_reasons];
    const isSuspicious = suspiciousReasons.length > 0;
    const fraudReason = suspiciousReasons.join("; ") || null;
    const billItems = Array.isArray(rawBillItems) ? rawBillItems.map(normalizeBillItem) : [];
    const autoItemCount = auto_item_count == null ? true : Boolean(auto_item_count);
    const finalItemCount =
      item_count != null && item_count !== "" ? Number(item_count) : autoItemCount ? getAutomaticItemCount(billItems) : 0;

    const columns = [
      "user_id",
      "group_id",
      "title",
      "amount",
      "currency",
      "category"
    ];
    const params = [
      user_id,
      group_id,
      title,
      amount,
      currency || null,
      category
    ];

    if (supportsNote) {
      columns.push("note");
      params.push(String(note || "").trim() || null);
    }

    if (supportsNoteAttachment) {
      columns.push("note_attachment_url");
      params.push(noteAttachmentUrl);
    }

    columns.push(
      "expense_date",
      "bill_items",
      "discount_amount",
      "item_count",
      "auto_item_count",
      "receipt_url",
      "is_suspicious",
      "fraud_reason",
      "web_match_found",
      "web_match_count",
      "web_match_sources",
      "web_match_checked_at"
    );
    params.push(
      expense_date,
      JSON.stringify(billItems),
      discount_amount != null && discount_amount !== "" ? Number(discount_amount) : null,
      finalItemCount,
      autoItemCount,
      receipt_url,
      isSuspicious,
      fraudReason,
      false,
      0,
      JSON.stringify([]),
      null
    );

    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT INTO expenses (${columns.join(", ")}) VALUES (${placeholders})`;
    const result = await runQuery(sql, params);

    return res.status(201).json({
      message: "Expense created with receipt",
      expenseId: result.insertId,
      group_id,
      receipt_url,
      currency: currency || null,
      refunded_amount: null,
      refund_currency: null,
      refundedAmount: null,
      refundCurrency: null,
      note: String(note || "").trim() || null,
      note_attachment_url: noteAttachmentUrl,
      bill_items: billItems,
      discount_amount: discount_amount != null && discount_amount !== "" ? Number(discount_amount) : null,
      item_count: finalItemCount,
      auto_item_count: autoItemCount,
      is_suspicious: isSuspicious,
      suspicious_reason: fraudReason,
      suspicious_reasons: suspiciousReasons,
      web_match_found: false,
      web_match_count: 0,
      web_match_sources: [],
      web_match_checked_at: null
    });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

const getMyExpenses = (req, res) => {
  const user_id = req.user.id;
  const group_id = req.group.id;

  const sql = `
    SELECT * FROM expenses
    WHERE user_id = ?
      AND group_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [user_id, group_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Server error",
        error: err.message
      });
    }

    res.status(200).json(results.map(normalizeExpenseRecord));
  });
};

const getPendingExpenses = (req, res) => {
  const sql = `
    SELECT expenses.*, users.full_name, users.email
    FROM expenses
    JOIN users ON expenses.user_id = users.id
    WHERE expenses.status = 'pending'
      AND expenses.group_id = ?
    ORDER BY expenses.created_at DESC
  `;

  db.query(sql, [req.group.id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Server error",
        error: err.message
      });
    }

    res.status(200).json(results.map(normalizeExpenseRecord));
  });
};

const updateExpenseStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = ["approved", "rejected", "reimbursed"];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      message: "Invalid status. Allowed values: approved, rejected, reimbursed"
    });
  }

  try {
    const results = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [id, req.group.id]);
    const expense = results[0];

    if (!expense) {
      return res.status(404).json({
        message: "Expense not found"
      });
    }

    const refundPayload = normalizeRefundPayload(req.body, expense);
    if (refundPayload.error) {
      return res.status(400).json({
        message: refundPayload.error
      });
    }

    await runQuery(
      `
        UPDATE expenses
        SET status = ?,
            refunded_amount = ?,
            refund_currency = ?
        WHERE id = ? AND group_id = ?
      `,
      [status, refundPayload.refundedAmount, refundPayload.refundCurrency, id, req.group.id]
    );

    const updatedResults = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [id, req.group.id]);

    return res.status(200).json({
      message: "Expense status updated successfully",
      expenseId: id,
      newStatus: status,
      expense: normalizeExpenseRecord(updatedResults[0])
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

const getExpenseDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const results = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [id, req.group.id]);
    const expense = results[0];
    const access = ensureExpenseAccess(expense, req);

    if (!access.allowed) {
      return res.status(access.status).json({
        message: access.message
      });
    }

    return res.status(200).json({
      expense: normalizeExpenseRecord(expense)
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

const updateExpenseDetails = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    amount,
    currency,
    category,
    refundedAmount,
    refunded_amount,
    refundCurrency,
    refund_currency,
    note,
    expense_date,
    bill_items: rawBillItems,
    discount_amount,
    item_count,
    auto_item_count
  } = req.body || {};

  try {
    const supportsNote = await hasExpenseColumn("note");
    const supportsNoteAttachment = await hasExpenseColumn("note_attachment_url");
    const results = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [id, req.group.id]);
    const expense = results[0];
    const access = ensureExpenseAccess(expense, req);

    if (!access.allowed) {
      return res.status(access.status).json({
        message: access.message
      });
    }

    const isTryingToUpdateRefund =
      refundedAmount !== undefined ||
      refunded_amount !== undefined ||
      refundCurrency !== undefined ||
      refund_currency !== undefined;

    if (isTryingToUpdateRefund && !canReviewGroupExpenses(req)) {
      return res.status(403).json({
        message: "You do not have permission to update refund values"
      });
    }

    const refundPayload = normalizeRefundPayload(req.body, expense);
    if (refundPayload.error) {
      return res.status(400).json({
        message: refundPayload.error
      });
    }

    const billItems = Array.isArray(rawBillItems) ? rawBillItems.map(normalizeBillItem) : [];
    const autoItemCount = auto_item_count == null ? true : Boolean(auto_item_count);
    const finalItemCount =
      item_count != null && item_count !== "" ? Number(item_count) : autoItemCount ? getAutomaticItemCount(billItems) : 0;

    const updateFields = [
      { column: "title", value: title || expense.title },
      { column: "amount", value: amount != null && amount !== "" ? Number(amount) : expense.amount },
      { column: "currency", value: currency || null },
      { column: "category", value: category || expense.category }
    ];

    if (supportsNote) {
      updateFields.push({
        column: "note",
        value: note !== undefined ? String(note || "").trim() || null : expense.note
      });
    }

    if (supportsNoteAttachment) {
      updateFields.push({
        column: "note_attachment_url",
        value: expense.note_attachment_url || null
      });
    }

    updateFields.push(
      { column: "expense_date", value: expense_date || expense.expense_date },
      { column: "bill_items", value: JSON.stringify(billItems) },
      { column: "discount_amount", value: discount_amount != null && discount_amount !== "" ? Number(discount_amount) : null },
      { column: "item_count", value: finalItemCount },
      { column: "auto_item_count", value: autoItemCount },
      { column: "refunded_amount", value: refundPayload.refundedAmount },
      { column: "refund_currency", value: refundPayload.refundCurrency }
    );

    const updateSql = `
      UPDATE expenses
      SET ${updateFields.map(({ column }) => `${column} = ?`).join(", ")}
      WHERE id = ?
    `;
    const updateParams = [...updateFields.map(({ value }) => value), id];

    await runQuery(updateSql, updateParams);

    const updatedResults = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [id, req.group.id]);
    return res.status(200).json({
      message: "Expense details updated successfully",
      expense: normalizeExpenseRecord(updatedResults[0])
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to update expense details",
      error: error.message
    });
  }
};

const runSupervisorWebMatchCheck = async (req, res) => {
  const { id } = req.params;

  try {
    const results = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [id, req.group.id]);
    const expense = results[0];

    if (!expense) {
      return res.status(404).json({
        message: "Expense not found"
      });
    }

    if (!expense.receipt_url) {
      return res.status(400).json({
        message: "This expense does not have an uploaded receipt image"
      });
    }

    const webMatch = await detectReceiptWebMatch(
      path.join(process.cwd(), "uploads", expense.receipt_url),
      expense
    );

    if (!webMatch.provider_configured) {
      return res.status(400).json({
        message: "Google Vision web match is not configured on the backend"
      });
    }

    const existingReasons = parseFraudReasons(expense.fraud_reason).filter(
      (reason) => reason !== GOOGLE_VISION_REASON
    );
    const updatedReasons = webMatch.web_match_reason
      ? [...existingReasons, webMatch.web_match_reason]
      : existingReasons;
    const updatedFraudReason = buildFraudReason(updatedReasons);
    const isSuspicious = updatedReasons.length > 0;

    const updateSql = `
      UPDATE expenses
      SET is_suspicious = ?,
          fraud_reason = ?,
          web_match_found = ?,
          web_match_count = ?,
          web_match_sources = ?,
          web_match_checked_at = NOW()
      WHERE id = ?
    `;

    await runQuery(updateSql, [
      isSuspicious,
      updatedFraudReason,
      webMatch.web_match_found,
      webMatch.web_match_count,
      JSON.stringify(webMatch.web_match_sources),
      id
    ]);

    const updatedExpenseResults = await runQuery("SELECT * FROM expenses WHERE id = ? AND group_id = ? LIMIT 1", [
      id,
      req.group.id
    ]);
    const updatedExpense = normalizeExpenseRecord(updatedExpenseResults[0]);

    return res.status(200).json({
      message: webMatch.web_match_found
        ? "Public web match check completed. Possible matches found."
        : "Public web match check completed. No matches found.",
      expense: updatedExpense,
      web_match_found: updatedExpense.web_match_found,
      web_match_count: updatedExpense.web_match_count,
      web_match_sources: updatedExpense.web_match_sources,
      web_match_best_score: updatedExpense.web_match_best_score,
      web_match_best_reasons: updatedExpense.web_match_best_reasons,
      suspicious_reason: updatedExpense.suspicious_reason
    });
  } catch (error) {
    return res.status(500).json({
      message: "Web match check failed",
      error: error.message
    });
  }
};

module.exports = {
  createExpense,
  getMyExpenses,
  getPendingExpenses,
  getExpenseDetails,
  updateExpenseDetails,
  updateExpenseStatus,
  runSupervisorWebMatchCheck
};
