const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatCell = (value) => {
  if (value == null) {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }

  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
};

const formatRow = (values) => `<Row>${values.map(formatCell).join("")}</Row>`;

const buildEmployeeHistoryWorkbook = ({ groupName, employee, expenses, startDate, endDate, exportedAt }) => {
  const headerRows = [
    ["Employee Operations Export"],
    ["Workspace", groupName || ""],
    ["Employee", employee.full_name || ""],
    ["Email", employee.email || ""],
    ["Role", employee.role || ""],
    ["Joined At", employee.joined_at || ""],
    ["Start Date", startDate || ""],
    ["End Date", endDate || ""],
    ["Exported At", exportedAt || ""],
    ["Expense Count", Number(employee.expense_count || 0)],
    ["Total Amount", Number(employee.total_amount || 0)],
    []
  ];

  const tableHeader = [[
    "Submission Date",
    "Operation Type",
    "Amount",
    "Status",
    "Bill Name / Reference",
    "Notes",
    "Currency",
    "Created At",
    "Receipt Reference",
    "Suspicious"
  ]];

  const expenseRows = expenses.map((expense) => [
    expense.created_at || "",
    expense.category || "Bill",
    expense.amount != null ? Number(expense.amount) : "",
    expense.status || "",
    expense.title || "",
    expense.note || "",
    expense.currency || "",
    expense.created_at || "",
    expense.receipt_url || "",
    expense.is_suspicious ? "Yes" : "No"
  ]);

  const rows = [...headerRows, ...tableHeader, ...expenseRows].map(formatRow).join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="History">
  <Table>
   ${rows}
  </Table>
 </Worksheet>
</Workbook>`;
};

module.exports = {
  EXCEL_MIME_TYPE,
  buildEmployeeHistoryWorkbook
};
