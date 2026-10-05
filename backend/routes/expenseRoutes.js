const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");
const { loadActiveGroup } = require("../middleware/groupMiddleware");
const expenseUpload = require("../middleware/expenseUploadMiddleware");

const {
  createExpense,
  getMyExpenses,
  getPendingExpenses,
  getExpenseDetails,
  updateExpenseDetails,
  updateExpenseStatus,
  runSupervisorWebMatchCheck
} = require("../controllers/expenseController");

router.post(
  "/",
  verifyToken,
  loadActiveGroup,
  (req, res, next) => {
    expenseUpload.fields([
      { name: "receipt", maxCount: 1 },
      { name: "note_attachment", maxCount: 1 }
    ])(req, res, function (err) {
      if (err) {
        return res.status(400).json({
          message: "Upload failed",
          error: err.message
        });
      }

      next();
    });
  },
  createExpense
);
router.get("/my-expenses", verifyToken, loadActiveGroup, getMyExpenses);

router.get(
  "/pending",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  getPendingExpenses
);

router.get("/:id", verifyToken, loadActiveGroup, getExpenseDetails);
router.put("/:id", verifyToken, loadActiveGroup, updateExpenseDetails);

router.put(
  "/:id/web-match-check",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  runSupervisorWebMatchCheck
);

router.put(
  "/:id/status",
  verifyToken,
  loadActiveGroup,
  allowRoles("owner", "responsable", "supervisor", "admin"),
  updateExpenseStatus
);

module.exports = router;
