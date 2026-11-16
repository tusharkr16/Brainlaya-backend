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

  const admin    = await User.create({ name: "Ada Admin",      email: "admin@brainlaya.dev",   passwordHash, role: "admin" });
  const t1       = await User.create({ name: "Sarah Jenkins",  email: "teacher@brainlaya.dev", passwordHash, role: "teacher" });
  const t2       = await User.create({ name: "Marcus Lee",     email: "marcus@brainlaya.dev",  passwordHash, role: "teacher" });
  const t3       = await User.create({ name: "Dr. Amelia Vance", email: "amelia@brainlaya.dev", passwordHash, role: "teacher" });
  const t4       = await User.create({ name: "Prof. Michael Chen", email: "mchen@brainlaya.dev", passwordHash, role: "teacher" });
  const t5       = await User.create({ name: "Arjun Patel",    email: "arjun@brainlaya.dev",   passwordHash, role: "teacher" });
  const t6       = await User.create({ name: "Lila Roberts",   email: "lila@brainlaya.dev",    passwordHash, role: "teacher" });
  const student  = await User.create({ name: "Sam Student",    email: "student@brainlaya.dev", passwordHash, role: "student" });
  const student2 = await User.create({ name: "Priya Patel",    email: "priya@brainlaya.dev",   passwordHash, role: "student" });

  const now = new Date();
  const courseDefs = [
    // Science
    { title: "Intro to Astrophysics", description: "A beginner-friendly tour of stars, galaxies, and the physics that governs them.", category: "Science", price: 49, teacherId: t1._id },
    { title: "Introduction to Molecular Biology", description: "Explore the building blocks of life through lab-driven lessons and expert breakdowns.", category: "Science", price: 75, teacherId: t4._id },
    { title: "Chemistry for Curious Minds", description: "From atoms to reactions — a visual, hands-on approach to general chemistry.", category: "Science", price: 59, teacherId: t3._id },
    // Technology
    { title: "Python for Future Engineers", description: "Learn Python fundamentals through hands-on, project-based lessons built for future engineers.", category: "Technology", price: 99, teacherId: t5._id },
    { title: "Full-Stack Development Bootcamp", description: "From HTML basics to deploying a full MERN stack application.", category: "Technology", price: 0, teacherId: t1._id },
    { title: "Machine Learning Foundations", description: "Understand the core algorithms behind ML and build your first predictive models.", category: "Technology", price: 119, teacherId: t2._id },
    { title: "Cloud Computing with AWS", description: "Deploy, scale, and secure applications using Amazon Web Services.", category: "Technology", price: 89, teacherId: t5._id },
    // Design
    { title: "Modern UX/UI Design Principles", description: "Learn the fundamentals of user-centered design and build a portfolio-ready case study.", category: "Design", price: 79, teacherId: t2._id },
    { title: "UI/UX Foundations for Teens", description: "Master the art of aligning user needs with business goals through advanced research and strategic design.", category: "Design", price: 120, teacherId: t6._id },
    { title: "Figma for Beginners", description: "Go from blank canvas to polished prototype in Figma — the industry-standard design tool.", category: "Design", price: 0, teacherId: t6._id },
    // Mathematics
    { title: "Advanced Calculus & Analytic Geometry", description: "Master complex analysis, multivariable calculus, and differential equations with expert-led courses.", category: "Mathematics", price: 89, teacherId: t1._id },
    { title: "Linear Algebra Essentials", description: "Vectors, matrices, and transformations explained visually for engineers and data scientists.", category: "Mathematics", price: 69, teacherId: t4._id },
    { title: "Statistics & Probability Crash Course", description: "Build a solid foundation in statistical thinking with real-world examples and exercises.", category: "Mathematics", price: 55, teacherId: t3._id },
    // Business
    { title: "Startup Fundamentals", description: "Learn how to validate ideas, build an MVP, and pitch to investors with confidence.", category: "Business", price: 99, teacherId: t2._id },
    { title: "Financial Literacy for Everyone", description: "Understand budgeting, investing, and personal finance in plain English.", category: "Business", price: 0, teacherId: t5._id },
    // Marketing
    { title: "Digital Marketing Masterclass", description: "SEO, paid ads, social media, and email marketing — all in one comprehensive course.", category: "Marketing", price: 85, teacherId: t6._id },
    { title: "Content Strategy & Copywriting", description: "Write words that convert — learn the frameworks behind high-performing content.", category: "Marketing", price: 65, teacherId: t2._id },
    // Arts
    { title: "Astrophysics: Beyond the Solar System", description: "A guided tour of galaxies, black holes, and the physics that govern the cosmos.", category: "Arts", price: 110, teacherId: t3._id },
    { title: "Creative Writing Workshop", description: "Find your voice, build compelling characters, and finish the story you've always wanted to tell.", category: "Arts", price: 45, teacherId: t6._id },
    { title: "Music Theory for Producers", description: "Learn scales, chords, and song structure to take your beats to the next level.", category: "Arts", price: 0, teacherId: t5._id },
  ];

  const courses = await Course.insertMany(
    courseDefs.map(c => ({ ...c, status: "approved", publishedAt: now }))
  );

  const approvedCourse = courses[0];

  const pendingCourse = await Course.create({
    title: "Advanced Machine Learning Research",
    description: "Deep dive into cutting-edge ML techniques — transformers, diffusion models, and beyond.",
    category: "Technology",
    price: 149,
    teacherId: t2._id,
    status: "pending_approval",
  });

  const draftCourse = await Course.create({
    title: "Quantum Computing Intro",
    description: "Understand qubits, superposition, and quantum gates from first principles.",
    category: "Science",
    price: 99,
    teacherId: t4._id,
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
    userId: t1._id,
    type: "new_enrollment",
    message: `${student.name} enrolled in "${approvedCourse.title}"`,
    relatedCourseId: approvedCourse._id,
  });
  await Notification.create({
    userId: admin._id,
    type: "course_submitted",
    message: `${t2.name} submitted "${pendingCourse.title}" for approval`,
    relatedCourseId: pendingCourse._id,
  });

  await ClassSchedule.insertMany([
    { courseId: approvedCourse._id, teacherId: t1._id, title: "Welcome to the Cosmos", dayOfWeek: 1, startTime: "09:30", endTime: "10:30", color: "#7fa8ff" },
    { courseId: approvedCourse._id, teacherId: t1._id, title: "Stars and Stellar Evolution", dayOfWeek: 3, startTime: "10:00", endTime: "11:00", color: "#ffc94d" },
    { courseId: approvedCourse._id, teacherId: t1._id, title: "Galaxies and Cosmology", dayOfWeek: 5, startTime: "11:30", endTime: "12:30", color: "#c4a6ff" },
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
