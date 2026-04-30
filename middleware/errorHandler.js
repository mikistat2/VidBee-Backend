// Global error handling middleware
// Must be registered LAST with app.use() and must have 4 parameters.

import logger from "../utils/logger.js";

export default function errorHandler(err, _req, res, _next) {
  // Log the full error for debugging
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });

  // Don't leak internal details in production
  const isDev = process.env.NODE_ENV === "development";

  res.status(err.status || 500).json({
    error: isDev ? err.message : "Internal server error.",
    ...(isDev && { stack: err.stack }),
  });
}
