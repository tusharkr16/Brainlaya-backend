const express = require("express");
const Notification = require("../models/Notification");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { parsePagination, paginationMeta } = require("../utils/paginate");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { userId: req.user.id };

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, read: false }),
    ]);

    res.json({ success: true, message: "OK", data: notifications, meta: { ...paginationMeta(total, page, limit), unreadCount } });
  })
);

router.patch(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOne({ _id: req.params.id, userId: req.user.id });
    if (!notification) throw new AppError(404, "Notification not found");
    notification.read = true;
    await notification.save();
    res.json({ success: true, message: "Marked read", data: notification });
  })
);

router.patch(
  "/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
    res.json({ success: true, message: "All marked read", data: null });
  })
);

module.exports = router;
