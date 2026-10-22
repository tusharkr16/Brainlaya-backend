const bcrypt = require("bcryptjs");
const { connectDB, mongoose } = require("./lib/db");
const logger = require("./lib/logger");

const User = require("./models/User");
const Course = require("./models/Course");
const Lesson = require("./models/Lesson");
const Enrollment = require("./models/Enrollment");
const LessonProgress = require("./models/LessonProgress");
const Notification = require("./models/Notification");
const AuditLog = require("./models/AuditLog");
const RefreshToken = require("./models/RefreshToken");
const ClassSchedule = require("./models/ClassSchedule");

const PASSWORD = "Password123!";

async function seed() {
  await connectDB();
  await Promise.all(
    [User, Course, Lesson, Enrollment, LessonProgress, Notification, AuditLog, RefreshToken, ClassSchedule].map((m) =>
      m.deleteMany({})
    )
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const admin = await User.create({ name: "Ada Admin", email: "admin@brainlaya.dev", passwordHash, role: "admin" });
  const teacher = await User.create({ name: "Sarah Jenkins", email: "teacher@brainlaya.dev", passwordHash, role: "teacher" });
  const teacher2 = await User.create({ name: "Marcus Lee", email: "marcus@brainlaya.dev", passwordHash, role: "teacher" });
  const student = await User.create({ name: "Sam Student", email: "student@brainlaya.dev", passwordHash, role: "student" });
  const student2 = await User.create({ name: "Priya Patel", email: "priya@brainlaya.dev", passwordHash, role: "student" });

  const approvedCourse = await Course.create({
    title: "Intro to Astrophysics",
    description: "A beginner-friendly tour of stars, galaxies, and the physics that governs them.",
    category: "Science",
    price: 49,
    teacherId: teacher._id,
    status: "approved",
    publishedAt: new Date(),
  });

  const pendingCourse = await Course.create({
    title: "Modern UX/UI Design Principles",
    description: "Learn the fundamentals of user-centered design and build a portfolio-ready case study.",
    category: "Design",
    price: 79,
    teacherId: teacher2._id,
    status: "pending_approval",
  });

  const draftCourse = await Course.create({
    title: "Full-Stack Development Bootcamp",
    description: "From HTML basics to deploying a full MERN stack application.",
    category: "Technology",
    price: 0,
    teacherId: teacher._id,
    status: "draft",
  });

  const lessons = await Lesson.insertMany([
    { courseId: approvedCourse._id, title: "Welcome to the Cosmos", content: "Course overview and how the universe is structured.", order: 0 },
    { courseId: approvedCourse._id, title: "Stars and Stellar Evolution", content: "How stars are born, live, and die.", order: 1 },
    { courseId: approvedCourse._id, title: "Galaxies and Cosmology", content: "The large-scale structure of the universe.", order: 2 },
  ]);

  await Enrollment.create({ studentId: student._id, courseId: approvedCourse._id });
  await Enrollment.create({ studentId: student2._id, courseId: approvedCourse._id });

  await LessonProgress.create({ studentId: student._id, lessonId: lessons[0]._id, courseId: approvedCourse._id });
  await LessonProgress.create({ studentId: student2._id, lessonId: lessons[0]._id, courseId: approvedCourse._id });
  await LessonProgress.create({ studentId: student2._id, lessonId: lessons[1]._id, courseId: approvedCourse._id });

  await Notification.create({
    userId: teacher._id,
    type: "new_enrollment",
    message: `${student.name} enrolled in "${approvedCourse.title}"`,
    relatedCourseId: approvedCourse._id,
  });
  await Notification.create({
    userId: admin._id,
    type: "course_submitted",
    message: `${teacher2.name} submitted "${pendingCourse.title}" for approval`,
    relatedCourseId: pendingCourse._id,
  });

  await ClassSchedule.insertMany([
    { courseId: approvedCourse._id, teacherId: teacher._id, title: "Welcome to the Cosmos", dayOfWeek: 1, startTime: "09:30", endTime: "10:30", color: "#7fa8ff" },
    { courseId: approvedCourse._id, teacherId: teacher._id, title: "Stars and Stellar Evolution", dayOfWeek: 3, startTime: "10:00", endTime: "11:00", color: "#ffc94d" },
    { courseId: approvedCourse._id, teacherId: teacher._id, title: "Galaxies and Cosmology", dayOfWeek: 5, startTime: "11:30", endTime: "12:30", color: "#c4a6ff" },
  ]);

  logger.info("Seed complete");
  logger.info(`Login with any of these (password: ${PASSWORD}):`);
  logger.info(`  admin@brainlaya.dev / teacher@brainlaya.dev / marcus@brainlaya.dev / student@brainlaya.dev / priya@brainlaya.dev`);
  logger.info(`Lessons seeded: ${lessons.length}`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
