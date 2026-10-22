const AppError = require("../utils/AppError");

// Validates req[part] against a zod schema, replacing it with the parsed
// (and coerced/defaulted) value so downstream handlers get clean input.
function validate(schema, part = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(new AppError(400, "Validation failed", result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)));
    }
    req[part] = result.data;
    next();
  };
}

module.exports = validate;
