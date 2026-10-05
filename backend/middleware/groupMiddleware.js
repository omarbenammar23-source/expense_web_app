const { runQuery } = require("../utils/fraudDetection");

const normalizeGroupRecord = (row) => ({
  id: Number(row.group_id || row.id),
  name: row.group_name || row.name,
  slug: row.group_slug || row.slug,
  invite_code: row.invite_code,
  owner_user_id: Number(row.owner_user_id),
  created_at: row.group_created_at || row.created_at
});

const normalizeMembershipRecord = (row) => ({
  id: Number(row.membership_id || row.id),
  group_id: Number(row.group_id),
  user_id: Number(row.user_id),
  role: row.membership_role || row.role,
  status: row.membership_status || row.status,
  created_at: row.membership_created_at || row.created_at,
  updated_at: row.membership_updated_at || row.updated_at
});

const loadActiveGroup = async (req, res, next) => {
  const groupHeader = req.headers["x-group-id"] || req.query.group_id || req.body?.group_id;
  const groupId = Number(groupHeader);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({
      message: "An active workspace is required for this action"
    });
  }

  try {
    const rows = await runQuery(
      `
        SELECT
          g.id AS group_id,
          g.name AS group_name,
          g.slug AS group_slug,
          g.invite_code,
          g.owner_user_id,
          g.created_at AS group_created_at,
          gm.id AS membership_id,
          gm.user_id,
          gm.role AS membership_role,
          gm.status AS membership_status,
          gm.created_at AS membership_created_at,
          gm.updated_at AS membership_updated_at
        FROM \`groups\` g
        LEFT JOIN \`group_members\` gm
          ON gm.group_id = g.id
         AND gm.user_id = ?
         AND gm.status = 'active'
        WHERE g.id = ?
        LIMIT 1
      `,
      [req.user.id, groupId]
    );

    const row = rows[0];
    if (!row) {
      return res.status(404).json({
        message: "Workspace not found"
      });
    }

    if (!row.membership_id && req.user.role !== "admin") {
      return res.status(403).json({
        message: "You do not have access to this workspace"
      });
    }

    req.group = normalizeGroupRecord(row);
    req.groupMembership = row.membership_id
      ? normalizeMembershipRecord(row)
      : {
          id: null,
          group_id: Number(row.group_id),
          user_id: Number(req.user.id),
          role: "admin",
          status: "active"
        };

    next();
  } catch (error) {
    return res.status(500).json({
      message: "Unable to load the active workspace",
      error: error.message
    });
  }
};

module.exports = {
  loadActiveGroup
};
