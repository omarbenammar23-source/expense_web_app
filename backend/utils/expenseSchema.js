const { runQuery } = require("./fraudDetection");

let expenseColumnsPromise = null;

const loadExpenseColumns = async () => {
  const rows = await runQuery("SHOW COLUMNS FROM expenses");
  return new Set(rows.map((row) => String(row.Field || "").toLowerCase()).filter(Boolean));
};

const getExpenseColumns = async () => {
  if (!expenseColumnsPromise) {
    expenseColumnsPromise = loadExpenseColumns().catch((error) => {
      expenseColumnsPromise = null;
      throw error;
    });
  }

  return expenseColumnsPromise;
};

const hasExpenseColumn = async (columnName) => {
  const columns = await getExpenseColumns();
  return columns.has(String(columnName || "").toLowerCase());
};

module.exports = {
  hasExpenseColumn
};
