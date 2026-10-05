const express = require("express");

const verifyToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const { loadActiveGroup } = require("../middleware/groupMiddleware");
const {
  listMyGroups,
  createGroup,
  requestGroupMembership,
  listJoinRequests,
  reviewJoinRequest,
  listGroupEmployees,
  getGroupEmployeeHistory,
  exportGroupEmployeeHistory,
  exportGroupHistory
} = require("../controllers/groupController");

const router = express.Router();

router.get("/", verifyToken, listMyGroups);
router.post("/", verifyToken, createGroup);
router.post("/join-requests", verifyToken, requestGroupMembership);
router.get(
  "/employees",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  listGroupEmployees
);
router.get(
  "/employees/:userId/history",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  getGroupEmployeeHistory
);
router.get(
  "/history/export",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  exportGroupHistory
);
router.get(
  "/employees/:userId/history/export",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  exportGroupEmployeeHistory
);
router.get("/join-requests", verifyToken, loadActiveGroup, allowRoles("owner", "admin"), listJoinRequests);
router.put(
  "/join-requests/:id",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "admin"),
  reviewJoinRequest
);

module.exports = router;
