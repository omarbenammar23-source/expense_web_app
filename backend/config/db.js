const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const ensureExpenseSchema = () => {
  const schemaUpdates = [
    {
      column: "note",
      sql: "ALTER TABLE expenses ADD COLUMN note TEXT NULL AFTER category"
    },
    {
      column: "note_attachment_url",
      sql: "ALTER TABLE expenses ADD COLUMN note_attachment_url VARCHAR(255) NULL AFTER note"
    },
    {
      column: "refunded_amount",
      sql: "ALTER TABLE expenses ADD COLUMN refunded_amount DECIMAL(10,2) NULL AFTER amount"
    },
    {
      column: "refund_currency",
      sql: "ALTER TABLE expenses ADD COLUMN refund_currency VARCHAR(8) NULL AFTER refunded_amount"
    }
  ];

  schemaUpdates.forEach(({ column, sql }) => {
    db.query(`SHOW COLUMNS FROM expenses LIKE '${column}'`, (checkError, results) => {
      if (checkError) {
        console.error(`Failed to inspect expenses schema for ${column}:`, checkError.message);
        return;
      }

      if (Array.isArray(results) && results.length > 0) {
        return;
      }

      db.query(sql, (alterError) => {
        if (alterError) {
          console.error(`Failed to add ${column} column to expenses:`, alterError.message);
          return;
        }

        console.log(`Added missing ${column} column to expenses table`);
      });
    });
  });
};

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err.message);
  } else {
    console.log("Connected to MySQL database");
    ensureExpenseSchema();
  }
});

module.exports = db;
