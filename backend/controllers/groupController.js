const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { runQuery } = require("../utils/fraudDetection");
const { hasExpenseColumn } = require("../utils/expenseSchema");

const ACTIVE_MEMBER_STATUS = "active";
const PENDING_REQUEST_STATUS = "pending";
const RESPONSABLE_ROLE = "responsable";
const LEGACY_RESPONSABLE_ROLE = "supervisor";
const REVIEWABLE_GROUP_ROLES = ["owner", RESPONSABLE_ROLE, LEGACY_RESPONSABLE_ROLE, "admin"];
const ASSIGNABLE_GROUP_ROLES = ["employee", RESPONSABLE_ROLE];
const OWNER_ONLY_GROUP_ROLES = ["owner", "admin"];
const JOIN_REQUEST_REVIEW_ROLES = OWNER_ONLY_GROUP_ROLES;

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

const buildInviteCode = () => crypto.randomBytes(4).toString("hex").toUpperCase();

const hasAnyGroupRole = (req, roles) =>
  roles.includes(req.groupMembership?.role) || roles.includes(req.user?.role);

const mapGroupRow = (row) => ({
  id: Number(row.id),
  name: row.name,
  slug: row.slug,
  invite_code: row.invite_code,
  owner_user_id: Number(row.owner_user_id),
  role: row.role || null,
  status: row.status || null,
  member_count: Number(row.member_count || 0),
  pending_request_count: Number(row.pending_request_count || 0),
  created_at: row.created_at
});

const mapJoinRequestRow = (row) => ({
  id: Number(row.id),
  group_id: Number(row.group_id),
  user_id: Number(row.user_id),
  requested_role: row.requested_role,
  status: row.status,
  created_at: row.created_at,
  reviewed_at: row.reviewed_at,
  reviewer_id: row.reviewed_by_user_id != null ? Number(row.reviewed_by_user_id) : null,
  user: {
    id: Number(row.user_id),
    full_name: row.full_name,
    email: row.email
  }
});

const mapEmployeeRow = (row) => ({
  id: Number(row.user_id),
  membership_id: Number(row.membership_id),
  full_name: row.full_name,
  email: row.email,
  role: row.role,
  joined_at: row.joined_at,
  expense_count: Number(row.expense_count || 0),
  total_amount: row.total_amount != null ? Number(row.total_amount) : 0
});

const mapEmployeeHistoryExpense = (row) => ({
  id: Number(row.id),
  title: row.title,
  amount: row.amount != null ? Number(row.amount) : null,
  currency: row.currency || null,
  refunded_amount: row.refunded_amount != null ? Number(row.refunded_amount) : null,
  refund_currency: row.refund_currency || null,
  refundedAmount: row.refunded_amount != null ? Number(row.refunded_amount) : null,
  refundCurrency: row.refund_currency || null,
  category: row.category || null,
  note: String(row.note || "").trim() || null,
  note_attachment_url: row.note_attachment_url || null,
  status: row.status || "pending",
  expense_date: row.expense_date,
  created_at: row.created_at,
  receipt_url: row.receipt_url || null,
  is_suspicious: Boolean(row.is_suspicious)
});

const sanitizeFileNamePart = (value, fallback) =>
  String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;

const normalizeDateInput = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const normalizedValue = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  const parsedDate = new Date(`${normalizedValue}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return normalizedValue;
};

const buildDayBoundary = (date, boundary) => {
  if (!date) {
    return null;
  }

  if (boundary === "start") {
    return `${date} 00:00:00`;
  }

  const nextDay = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return `${nextDay.toISOString().slice(0, 10)} 00:00:00`;
};

const buildDateRangeFilter = (req) => {
  const startDate = normalizeDateInput(req.query?.start_date);
  const endDate = normalizeDateInput(req.query?.end_date);

  if ((req.query?.start_date && !startDate) || (req.query?.end_date && !endDate)) {
    return {
      error: "start_date and end_date must use YYYY-MM-DD format"
    };
  }

  if (startDate && endDate && startDate > endDate) {
    return {
      error: "start_date cannot be after end_date"
    };
  }

  return {
    startDate,
    endDate,
    startDateTime: buildDayBoundary(startDate, "start"),
    endDateExclusive: buildDayBoundary(endDate, "end")
  };
};

const loadEmployeeHistoryData = async ({
  groupId,
  userId,
  startDate,
  endDate,
  startDateTime,
  endDateExclusive
}) => {
  const supportsNote = await hasExpenseColumn("note");
  const supportsNoteAttachment = await hasExpenseColumn("note_attachment_url");
  const membershipRows = await runQuery(
    `
      SELECT
        gm.id AS membership_id,
        gm.user_id,
        gm.role,
        gm.created_at AS joined_at,
        u.full_name,
        u.email
      FROM \`group_members\` gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
        AND gm.user_id = ?
        AND gm.status = 'active'
        AND gm.role IN ('employee', 'responsable', 'supervisor')
      LIMIT 1
    `,
    [groupId, userId]
  );

  const member = membershipRows[0];
  if (!member) {
    return null;
  }

  const queryParams = [groupId, userId];
  const dateFilters = [];

  if (startDateTime) {
    dateFilters.push("AND created_at >= ?");
    queryParams.push(startDateTime);
  }

  if (endDateExclusive) {
    dateFilters.push("AND created_at < ?");
    queryParams.push(endDateExclusive);
  }

  const expenseRows = await runQuery(
    supportsNote
      ? `
      SELECT
        id,
        title,
        amount,
        currency,
        refunded_amount,
        refund_currency,
        category,
        note,
        ${supportsNoteAttachment ? "note_attachment_url" : "NULL AS note_attachment_url"},
        status,
        expense_date,
        created_at,
        receipt_url,
        is_suspicious
      FROM expenses
      WHERE group_id = ?
        AND user_id = ?
        ${dateFilters.join("\n        ")}
      ORDER BY created_at DESC, id DESC
    `
      : `
      SELECT
        id,
        title,
        amount,
        currency,
        refunded_amount,
        refund_currency,
        category,
        NULL AS note,
        ${supportsNoteAttachment ? "note_attachment_url" : "NULL AS note_attachment_url"},
        status,
        expense_date,
        created_at,
        receipt_url,
        is_suspicious
      FROM expenses
      WHERE group_id = ?
        AND user_id = ?
        ${dateFilters.join("\n        ")}
      ORDER BY created_at DESC, id DESC
    `,
    queryParams
  );

  return {
    employee: mapEmployeeRow({
      ...member,
      expense_count: expenseRows.length,
      total_amount: expenseRows.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
    }),
    expenses: expenseRows.map(mapEmployeeHistoryExpense)
  };
};

const loadGroupHistoryExportData = async ({ groupId, startDateTime, endDateExclusive }) => {
  const queryParams = [groupId, startDateTime, endDateExclusive];
  const expenseRows = await runQuery(
    `
      SELECT
        e.id,
        e.user_id,
        u.full_name,
        u.email,
        e.amount,
        e.refunded_amount,
        e.refund_currency,
        e.created_at
      FROM expenses e
      JOIN \`group_members\` gm
        ON gm.group_id = e.group_id
       AND gm.user_id = e.user_id
      JOIN users u
        ON u.id = e.user_id
      WHERE e.group_id = ?
        AND e.created_at >= ?
        AND e.created_at < ?
        AND gm.role IN ('employee', 'responsable', 'supervisor')
        AND gm.status = 'active'
      ORDER BY u.full_name ASC, u.email ASC, e.created_at ASC, e.id ASC
    `,
    queryParams
  );

  const employeeSections = [];
  let currentEmployee = null;

  expenseRows.forEach((row) => {
    const employeeId = Number(row.user_id);

    if (!currentEmployee || currentEmployee.id !== employeeId) {
      currentEmployee = {
        id: employeeId,
        full_name: row.full_name,
        email: row.email,
        expenses: []
      };
      employeeSections.push(currentEmployee);
    }

    currentEmployee.expenses.push({
      id: Number(row.id),
      amount: row.amount != null ? Number(row.amount) : null,
      refunded_amount: row.refunded_amount != null ? Number(row.refunded_amount) : null,
      refund_currency: row.refund_currency || null,
      created_at: row.created_at
    });
  });

  return employeeSections;
};

const listMyGroups = async (req, res) => {
  try {
    const groups = await runQuery(
      `
        SELECT
          g.id,
          g.name,
          g.slug,
          g.invite_code,
          g.owner_user_id,
          g.created_at,
          gm.role,
          gm.status,
          (
            SELECT COUNT(*)
            FROM \`group_members\` gm_count
            WHERE gm_count.group_id = g.id
              AND gm_count.status = 'active'
          ) AS member_count,
          (
            SELECT COUNT(*)
            FROM \`group_join_requests\` gjr_count
            WHERE gjr_count.group_id = g.id
              AND gjr_count.status = 'pending'
          ) AS pending_request_count
        FROM \`group_members\` gm
        JOIN \`groups\` g ON g.id = gm.group_id
        WHERE gm.user_id = ?
          AND gm.status = 'active'
        ORDER BY g.name ASC
      `,
      [req.user.id]
    );

    const pendingRequests = await runQuery(
      `
        SELECT
          gjr.id,
          gjr.group_id,
          gjr.user_id,
          gjr.requested_role,
          gjr.status,
          gjr.created_at,
          gjr.reviewed_at,
          gjr.reviewed_by_user_id,
          g.name AS group_name,
          g.slug AS group_slug,
          g.invite_code
        FROM \`group_join_requests\` gjr
        JOIN \`groups\` g ON g.id = gjr.group_id
        WHERE gjr.user_id = ?
        ORDER BY gjr.created_at DESC
      `,
      [req.user.id]
    );

    return res.status(200).json({
      groups: groups.map(mapGroupRow),
      membership_requests: pendingRequests.map((request) => ({
        id: Number(request.id),
        group_id: Number(request.group_id),
        group_name: request.group_name,
        group_slug: request.group_slug,
        invite_code: request.invite_code,
        requested_role: request.requested_role,
        status: request.status,
        created_at: request.created_at,
        reviewed_at: request.reviewed_at
      }))
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to load your workspaces",
      error: error.message
    });
  }
};

const createGroup = async (req, res) => {
  const { name } = req.body || {};
  const trimmedName = String(name || "").trim();

  if (!trimmedName) {
    return res.status(400).json({
      message: "Workspace name is required"
    });
  }

  try {
    const baseSlug = slugify(trimmedName) || `group-${Date.now()}`;
    let slug = baseSlug;
    let slugSuffix = 1;

    while (true) {
      const existing = await runQuery("SELECT id FROM `groups` WHERE slug = ? LIMIT 1", [slug]);
      if (!existing.length) {
        break;
      }

      slugSuffix += 1;
      slug = `${baseSlug}-${slugSuffix}`;
    }

    let inviteCode = buildInviteCode();
    while ((await runQuery("SELECT id FROM `groups` WHERE invite_code = ? LIMIT 1", [inviteCode])).length) {
      inviteCode = buildInviteCode();
    }

    const insertGroupResult = await runQuery(
      `
        INSERT INTO \`groups\` (name, slug, invite_code, owner_user_id)
        VALUES (?, ?, ?, ?)
      `,
      [trimmedName, slug, inviteCode, req.user.id]
    );

    await runQuery(
      `
        INSERT INTO \`group_members\` (group_id, user_id, role, status)
        VALUES (?, ?, 'owner', 'active')
      `,
      [insertGroupResult.insertId, req.user.id]
    );

    const createdRows = await runQuery(
      `
        SELECT
          g.id,
          g.name,
          g.slug,
          g.invite_code,
          g.owner_user_id,
          g.created_at,
          gm.role,
          gm.status,
          1 AS member_count,
          0 AS pending_request_count
        FROM \`groups\` g
        JOIN \`group_members\` gm
          ON gm.group_id = g.id
         AND gm.user_id = ?
        WHERE g.id = ?
        LIMIT 1
      `,
      [req.user.id, insertGroupResult.insertId]
    );

    return res.status(201).json({
      message: "Workspace created successfully",
      group: mapGroupRow(createdRows[0])
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to create the workspace",
      error: error.message
    });
  }
};

const requestGroupMembership = async (req, res) => {
  const inviteCode = String(req.body?.invite_code || "").trim().toUpperCase();

  if (!inviteCode) {
    return res.status(400).json({
      message: "Invite code is required"
    });
  }

  try {
    const groups = await runQuery("SELECT * FROM `groups` WHERE invite_code = ? LIMIT 1", [inviteCode]);
    const group = groups[0];

    if (!group) {
      return res.status(404).json({
        message: "No workspace was found for that invite code"
      });
    }

    const existingMemberships = await runQuery(
      `
        SELECT id, role, status
        FROM \`group_members\`
        WHERE group_id = ? AND user_id = ?
        LIMIT 1
      `,
      [group.id, req.user.id]
    );

    if (existingMemberships.length && existingMemberships[0].status === ACTIVE_MEMBER_STATUS) {
      return res.status(400).json({
        message: "You are already a member of this workspace"
      });
    }

    const existingRequests = await runQuery(
      `
        SELECT id, status
        FROM \`group_join_requests\`
        WHERE group_id = ? AND user_id = ? AND status = 'pending'
        LIMIT 1
      `,
      [group.id, req.user.id]
    );

    if (existingRequests.length) {
      return res.status(400).json({
        message: "You already have a pending request for this workspace"
      });
    }

    const insertResult = await runQuery(
      `
        INSERT INTO \`group_join_requests\` (group_id, user_id, requested_role, status)
        VALUES (?, ?, 'employee', 'pending')
      `,
      [group.id, req.user.id]
    );

    return res.status(201).json({
      message: "Join request sent successfully",
      request: {
        id: insertResult.insertId,
        group_id: Number(group.id),
        group_name: group.name,
        invite_code: group.invite_code,
        requested_role: "employee",
        status: PENDING_REQUEST_STATUS
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to send the join request",
      error: error.message
    });
  }
};

const listJoinRequests = async (req, res) => {
  if (!hasAnyGroupRole(req, JOIN_REQUEST_REVIEW_ROLES)) {
    return res.status(403).json({
      message: "You do not have permission to review requests for this workspace"
    });
  }

  try {
    const rows = await runQuery(
      `
        SELECT
          gjr.id,
          gjr.group_id,
          gjr.user_id,
          gjr.requested_role,
          gjr.status,
          gjr.created_at,
          gjr.reviewed_at,
          gjr.reviewed_by_user_id,
          u.full_name,
          u.email
        FROM \`group_join_requests\` gjr
        JOIN users u ON u.id = gjr.user_id
        WHERE gjr.group_id = ?
          AND gjr.status = 'pending'
        ORDER BY gjr.created_at ASC
      `,
      [req.group.id]
    );

    return res.status(200).json({
      requests: rows.map(mapJoinRequestRow)
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to load join requests",
      error: error.message
    });
  }
};

const listGroupEmployees = async (req, res) => {
  if (!hasAnyGroupRole(req, REVIEWABLE_GROUP_ROLES)) {
    return res.status(403).json({
      message: "You do not have permission to view employees for this workspace"
    });
  }

  try {
    const rows = await runQuery(
      `
        SELECT
          gm.id AS membership_id,
          gm.user_id,
          gm.role,
          gm.created_at AS joined_at,
          u.full_name,
          u.email,
          (
            SELECT COUNT(*)
            FROM expenses e
            WHERE e.group_id = gm.group_id
              AND e.user_id = gm.user_id
          ) AS expense_count,
          (
            SELECT COALESCE(SUM(e.amount), 0)
            FROM expenses e
            WHERE e.group_id = gm.group_id
              AND e.user_id = gm.user_id
          ) AS total_amount
        FROM \`group_members\` gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = ?
          AND gm.status = 'active'
          AND gm.role IN ('employee', 'responsable', 'supervisor')
        ORDER BY u.full_name ASC, u.email ASC
      `,
      [req.group.id]
    );

    return res.status(200).json({
      employees: rows.map(mapEmployeeRow)
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to load workspace employees",
      error: error.message
    });
  }
};

const getGroupEmployeeHistory = async (req, res) => {
  const userId = Number(req.params.userId);

  if (!hasAnyGroupRole(req, REVIEWABLE_GROUP_ROLES)) {
    return res.status(403).json({
      message: "You do not have permission to view employee history"
    });
  }

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      message: "A valid employee id is required"
    });
  }

  try {
    const dateRange = buildDateRangeFilter(req);
    if (dateRange.error) {
      return res.status(400).json({
        message: dateRange.error
      });
    }

    const history = await loadEmployeeHistoryData({
      groupId: req.group.id,
      userId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      startDateTime: dateRange.startDateTime,
      endDateExclusive: dateRange.endDateExclusive
    });

    if (!history) {
      return res.status(404).json({
        message: "Employee not found in this workspace"
      });
    }

    return res.status(200).json({
      employee: history.employee,
      filters: {
        start_date: dateRange.startDate,
        end_date: dateRange.endDate
      },
      expenses: history.expenses
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to load employee history",
      error: error.message
    });
  }
};

const exportGroupEmployeeHistory = async (req, res) => {
  const userId = Number(req.params.userId);

  if (!hasAnyGroupRole(req, REVIEWABLE_GROUP_ROLES)) {
    return res.status(403).json({
      message: "You do not have permission to export employee history"
    });
  }

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      message: "A valid employee id is required"
    });
  }

  try {
    const dateRange = buildDateRangeFilter(req);
    if (dateRange.error) {
      return res.status(400).json({
        message: dateRange.error
      });
    }

    const history = await loadEmployeeHistoryData({
      groupId: req.group.id,
      userId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      startDateTime: dateRange.startDateTime,
      endDateExclusive: dateRange.endDateExclusive
    });

    if (!history) {
      return res.status(404).json({
        message: "Employee not found in this workspace"
      });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Operations");

    worksheet.columns = [
      { header: "Upload Date", key: "uploadDate", width: 18 },
      { header: "Category", key: "category", width: 24 },
      { header: "Bill Amount", key: "billAmount", width: 16 },
      { header: "Refunded Amount", key: "refundedAmount", width: 18 },
      { header: "Refund Currency", key: "refundCurrency", width: 18 }
    ];

    history.expenses.forEach((expense) => {
      worksheet.addRow({
        uploadDate: expense.created_at ? new Date(expense.created_at) : null,
        category: expense.category || "",
        billAmount: expense.amount != null ? Number(expense.amount) : null,
        refundedAmount: expense.refunded_amount != null ? Number(expense.refunded_amount) : null,
        refundCurrency: expense.refund_currency || ""
      });
    });

    worksheet.getColumn("uploadDate").numFmt = "yyyy-mm-dd";
    worksheet.getColumn("billAmount").numFmt = "#,##0.00";
    worksheet.getColumn("refundedAmount").numFmt = "#,##0.00";
    worksheet.getRow(1).font = { bold: true };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="employee_operations.xlsx"');

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return res.status(500).json({
      message: "Unable to export employee history",
      error: error.message
    });
  }
};

const exportGroupHistory = async (req, res) => {
  if (!hasAnyGroupRole(req, REVIEWABLE_GROUP_ROLES)) {
    return res.status(403).json({
      message: "You do not have permission to export workspace history"
    });
  }

  try {
    const dateRange = buildDateRangeFilter(req);
    if (dateRange.error) {
      return res.status(400).json({
        message: dateRange.error
      });
    }

    if (!dateRange.startDate || !dateRange.endDate) {
      return res.status(400).json({
        message: "start_date and end_date are required"
      });
    }

    const employeeSections = await loadGroupHistoryExportData({
      groupId: req.group.id,
      startDateTime: dateRange.startDateTime,
      endDateExclusive: dateRange.endDateExclusive
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Operations");
    let currentRowNumber = 1;

    employeeSections.forEach((employeeSection, index) => {
      worksheet.getCell(`A${currentRowNumber}`).value = `Employee: ${employeeSection.full_name || employeeSection.email || `User ${employeeSection.id}`}`;
      worksheet.getCell(`A${currentRowNumber}`).font = { bold: true };
      currentRowNumber += 1;

      const headerRow = worksheet.getRow(currentRowNumber);
      headerRow.values = ["", "Upload Date", "Bill Amount", "Refunded Amount", "Refund Currency"];
      headerRow.font = { bold: true };
      currentRowNumber += 1;

      employeeSection.expenses.forEach((expense) => {
        const row = worksheet.getRow(currentRowNumber);
        row.getCell(1).value = null;
        row.getCell(2).value = expense.created_at ? new Date(expense.created_at) : null;
        row.getCell(3).value = expense.amount != null ? Number(expense.amount) : null;
        row.getCell(4).value = expense.refunded_amount != null ? Number(expense.refunded_amount) : null;
        row.getCell(5).value = expense.refund_currency || "";
        currentRowNumber += 1;
      });

      if (index < employeeSections.length - 1) {
        currentRowNumber += 1;
      }
    });

    worksheet.getColumn(1).width = 4;
    worksheet.getColumn(2).width = 18;
    worksheet.getColumn(3).width = 16;
    worksheet.getColumn(4).width = 18;
    worksheet.getColumn(5).width = 18;
    worksheet.getColumn(2).numFmt = "yyyy-mm-dd";
    worksheet.getColumn(3).numFmt = "#,##0.00";
    worksheet.getColumn(4).numFmt = "#,##0.00";

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=group_operations.xlsx");

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return res.status(500).json({
      message: "Unable to export workspace history",
      error: error.message
    });
  }
};

const reviewJoinRequest = async (req, res) => {
  const { id } = req.params;
  const status = String(req.body?.status || "").trim().toLowerCase();
  const role = String(req.body?.role || "employee").trim().toLowerCase();

  if (!hasAnyGroupRole(req, JOIN_REQUEST_REVIEW_ROLES)) {
    return res.status(403).json({
      message: "You do not have permission to review requests for this workspace"
    });
  }

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({
      message: "Status must be approved or rejected"
    });
  }

  if (status === "approved" && !ASSIGNABLE_GROUP_ROLES.includes(role)) {
    return res.status(400).json({
      message: "Role must be employee or responsable"
    });
  }

  try {
    const requests = await runQuery(
      `
        SELECT *
        FROM \`group_join_requests\`
        WHERE id = ?
          AND group_id = ?
        LIMIT 1
      `,
      [id, req.group.id]
    );

    const request = requests[0];
    if (!request) {
      return res.status(404).json({
        message: "Join request not found"
      });
    }

    if (request.status !== PENDING_REQUEST_STATUS) {
      return res.status(400).json({
        message: "This join request has already been reviewed"
      });
    }

    await runQuery(
      `
        UPDATE \`group_join_requests\`
        SET status = ?,
            requested_role = ?,
            reviewed_at = NOW(),
            reviewed_by_user_id = ?
        WHERE id = ?
      `,
      [status, status === "approved" ? role : request.requested_role, req.user.id, id]
    );

    if (status === "approved") {
      const memberships = await runQuery(
        `
          SELECT id
          FROM \`group_members\`
          WHERE group_id = ? AND user_id = ?
          LIMIT 1
        `,
        [request.group_id, request.user_id]
      );

      if (memberships.length) {
        await runQuery(
          `
            UPDATE \`group_members\`
            SET role = ?,
                status = 'active',
                updated_at = NOW()
            WHERE id = ?
          `,
          [role, memberships[0].id]
        );
      } else {
        await runQuery(
          `
            INSERT INTO \`group_members\` (group_id, user_id, role, status)
            VALUES (?, ?, ?, 'active')
          `,
          [request.group_id, request.user_id, role]
        );
      }
    }

    return res.status(200).json({
      message: status === "approved" ? "Join request approved" : "Join request rejected"
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to review the join request",
      error: error.message
    });
  }
};

module.exports = {
  listMyGroups,
  createGroup,
  requestGroupMembership,
  listJoinRequests,
  reviewJoinRequest,
  listGroupEmployees,
  getGroupEmployeeHistory,
  exportGroupEmployeeHistory,
  exportGroupHistory
};
