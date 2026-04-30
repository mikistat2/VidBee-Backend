import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import env from "./config/env.js";
import db from "./config/db.js";
import logger from "./utils/logger.js";

// ─── Route imports ──────────────────────────────────────────────────────────
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/upload.js";
import quizRoutes from "./routes/quiz.js";
import oauthRoutes from "./routes/oauth.js";

// ─── Middleware imports ─────────────────────────────────────────────────────
import errorHandler from "./middleware/errorHandler.js";

// ─── App setup ──────────────────────────────────────────────────────────────
const app = express();

// Security headers
app.use(helmet());

// Trust proxy if running behind a reverse proxy (e.g., Heroku, Vercel, Render, AWS)
app.set("trust proxy", 1);

// Rate limiting (max 100 requests per 15 minutes per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: "Too many requests from this IP, please try again later." }
});

// Apply rate limiter to all api routes
app.use("/api", limiter);

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS — allow the Vite dev server and any configured client URL(s)
// Set CLIENT_URL as a single origin or a comma-separated list of origins.
const configuredClientOrigins = String(env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([
    ...configuredClientOrigins,
    "http://localhost:5173",
    "http://localhost:4173",
    // ─── Capacitor / Android WebView origins ─────────────────────────
    // Capacitor v3+ sends this origin from the Android WebView
    "capacitor://localhost",
    // Capacitor v2 / fallback
    "http://localhost",
  ])
);
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no Origin header (e.g. native mobile, curl, Postman)
      // AND any explicitly listed origin.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// ─── Health check ───────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/auth", oauthRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/quiz", quizRoutes);

// ─── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// ─── Global error handler (must be last) ────────────────────────────────────
app.use(errorHandler);

// ─── Start server ───────────────────────────────────────────────────────────
const PORT = env.PORT;

// Verify DB connection before starting
db.query("SELECT NOW()")
  .then(() => {
    logger.info("✅ Connected to PostgreSQL");
    return db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation JSONB;");
  })
  .then(() => {
    app.listen(PORT, () => {
      logger.info(`🚀 VidBee server running on http://localhost:${PORT}`);
      logger.info(`   Environment: ${env.NODE_ENV}`);
    });
  })
  .catch((err) => {
    logger.error("❌ Failed to connect to PostgreSQL:", err.message);
    logger.error("   Make sure your database is running and .env is configured.");
    process.exit(1);
  });

export default app;
