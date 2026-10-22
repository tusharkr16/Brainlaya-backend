const { Schema, model } = require("mongoose");

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "teacher", "student"], default: "student" },
    avatar: { type: String, default: null },
    status: { type: String, enum: ["active", "suspended"], default: "active" },

    // Mentor/teacher public-profile fields — unused by students and admins.
    bio: { type: String, default: null, maxlength: 2000 },
    headline: { type: String, default: null, maxlength: 140 },
    subjects: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    location: { type: String, default: null, maxlength: 140 },
    sessionRate: { type: Number, default: null, min: 0 },
    availability: { type: String, default: null, maxlength: 2000 },
    teachingExperience: {
      type: [
        {
          title: { type: String, required: true, maxlength: 140 },
          place: { type: String, required: true, maxlength: 140 },
          period: { type: String, required: true, maxlength: 60 },
          description: { type: String, default: "", maxlength: 1000 },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    avatar: this.avatar,
    status: this.status,
    createdAt: this.createdAt,
    bio: this.bio,
    headline: this.headline,
    subjects: this.subjects,
    languages: this.languages,
    location: this.location,
    sessionRate: this.sessionRate,
    availability: this.availability,
    teachingExperience: this.teachingExperience,
  };
};

module.exports = model("User", userSchema);
