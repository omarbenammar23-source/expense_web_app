const express = require("express");
const router = express.Router();

const upload = require("../middleware/uploadMiddleware");
const verifyToken = require("../middleware/authMiddleware");
const { loadActiveGroup } = require("../middleware/groupMiddleware");
const { scanReceipt, scanAndSaveReceipt } = require("../controllers/ocrController");

router.post("/scan", (req, res, next) => {
  upload.single("receipt")(req, res, function (err) {
    if (err) {
      return res.status(400).json({
        message: "Upload failed",
        error: err.message
      });
    }
    next();
  });
}, scanReceipt);

router.post("/scan-and-save", verifyToken, loadActiveGroup, (req, res, next) => {
  upload.single("receipt")(req, res, function (err) {
    if (err) {
      return res.status(400).json({
        message: "Upload failed",
        error: err.message
      });
    }
    next();
  });
}, scanAndSaveReceipt);

module.exports = router;
