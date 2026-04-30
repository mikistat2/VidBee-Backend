import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Always load the server-local .env regardless of process cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const env = {
    // Server
    PORT: process.env.PORT || 5000,
    NODE_ENV: process.env.NODE_ENV || "development",

    // Database
    DB_HOST: process.env.DB_HOST || "localhost",
    DB_PORT: process.env.DB_PORT || 5432,
    DB_USER: process.env.DB_USER || "postgres",
    DB_PASSWORD: process.env.DB_PASSWORD || "147253@Mbt",
    DB_NAME: process.env.DB_NAME || "vidbee",

    // JWT
    JWT_SECRET: process.env.JWT_SECRET || "vidbee",
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

    // Gemini AI
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3-flash-preview",

    // Google OAuth
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    // Must match what you set in Google Cloud Console
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5000/auth/google/callback",

    // Client URL (for CORS)
    CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",
};

// Check all required variables are present at startup
const requiredVars = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "JWT_SECRET"];

for (const var_ of requiredVars) {
    if (!env[var_]) {
        console.error(`❌ Missing required environment variable: ${var_}`);
        process.exit(1); // Crash early so you know immediately what's missing
    }
}

// Warn (don't crash) for optional-but-important vars
if (!env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY not set — AI quiz generation will fail.");
}

if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn("⚠️  Google OAuth not set — 'Continue with Google' will be disabled until GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are configured.");
}

export default env;