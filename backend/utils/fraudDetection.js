const db = require("../config/db");

const HIGH_AMOUNT_THRESHOLD = 1000;

const runQuery = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(results);
    });
  });

const detectExpenseFraud = async ({ user_id, group_id, amount, expense_date }) => {
  const reasons = [];
  const normalizedAmount = Number(amount);

  if (Number.isFinite(normalizedAmount) && normalizedAmount > HIGH_AMOUNT_THRESHOLD) {
    reasons.push("Unusually high amount");
  }

  let duplicateSql = `
    SELECT id
    FROM expenses
    WHERE user_id = ? AND amount = ? AND expense_date = ?
  `;
  const duplicateParams = [user_id, normalizedAmount, expense_date];

  if (group_id != null) {
    duplicateSql += " AND group_id = ?";
    duplicateParams.push(group_id);
  }

  duplicateSql += " LIMIT 1";

  const duplicates = await runQuery(duplicateSql, duplicateParams);

  if (duplicates.length > 0) {
    reasons.push("Possible duplicate expense");
  }

  return {
    is_suspicious: reasons.length > 0,
    suspicious_reason: reasons[0] || null,
    suspicious_reasons: reasons
  };
};

module.exports = {
  HIGH_AMOUNT_THRESHOLD,
  runQuery,
  detectExpenseFraud
};
