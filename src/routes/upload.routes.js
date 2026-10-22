const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { upload, publicUrlFor } = require("../lib/storage");
const AppError = require("../utils/AppError");

const router = express.Router();

router.post(
  "/",
  requireAuth,
  requireRole("teacher", "admin"),
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return next(new AppError(400, err.message));
      if (!req.file) return next(new AppError(400, "No file uploaded"));
      res.status(201).json({ success: true, message: "Uploaded", data: { url: publicUrlFor(req.file.filename) } });
    });
  }
);

module.exports = router;
