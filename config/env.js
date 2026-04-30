import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Always load the server-local .env regardless of process cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const detectedProduction =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RENDER) ||
    Boolean(process.env.RENDER_EXTERNAL_URL);

const nodeEnv = process.env.NODE_ENV || (detectedProduction ? "production" : "development");

const renderExternalUrl = process.env.RENDER_EXTERNAL_URL
    ? String(process.env.RENDER_EXTERNAL_URL).replace(/\/+$/, "")
    : "";

const env = {
    // Server
    PORT: process.env.PORT || 5000,
    NODE_ENV: nodeEnv,

    // Database (local)
    DB_HOST: process.env.DB_HOST || "localhost",
    DB_PORT: process.env.DB_PORT || 5432,
    DB_USER: process.env.DB_USER || "postgres",
    DB_PASSWORD: process.env.DB_PASSWORD || "",
    DB_NAME: process.env.DB_NAME || "vidbee",

    // Database (Neon / production)
    DATABASE_URL: process.env.DATABASE_URL,

    // JWT
    JWT_SECRET: process.env.JWT_SECRET || "",
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",

    // Gemini AI
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3-flash-preview",

    // Google OAuth
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_CALLBACK_URL:
        process.env.GOOGLE_CALLBACK_URL ||
        (renderExternalUrl
            ? `${renderExternalUrl}/auth/google/callback`
            : "http://localhost:5000/auth/google/callback"),

    // Client URL (for CORS)
    CLIENT_URL: process.env.CLIENT_URL || (nodeEnv === "development" ? "http://localhost:5173" : ""),
};

function isValidHttpUrl(value) {
    try {
        const url = new URL(String(value));
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function hasLocalDbConfig(e) {
    return Boolean(e.DB_HOST && e.DB_USER && e.DB_NAME);
}

function hasDatabaseUrl(e) {
    return Boolean(e.DATABASE_URL);
}

// Validate URLs to prevent silent misconfig (common with copy/paste mistakes in .env)
if (env.CLIENT_URL && !isValidHttpUrl(env.CLIENT_URL)) {
    const msg = `❌ CLIENT_URL is not a valid http(s) URL: ${env.CLIENT_URL}`;
    if (env.NODE_ENV === "production") {
        console.error(msg);
        process.exit(1);
    } else {
        console.warn(msg);
        console.warn("   Falling back to http://localhost:5173 for development.");
        env.CLIENT_URL = "http://localhost:5173";
    }
}

if (env.GOOGLE_CALLBACK_URL && !isValidHttpUrl(env.GOOGLE_CALLBACK_URL)) {
    const msg = `❌ GOOGLE_CALLBACK_URL is not a valid http(s) URL: ${env.GOOGLE_CALLBACK_URL}`;
    if (env.NODE_ENV === "production") {
        console.error(msg);
        process.exit(1);
    } else {
        console.warn(msg);
    }
}

// Required variables
if (!env.JWT_SECRET) {
    console.error("❌ Missing required environment variable: JWT_SECRET");
    process.exit(1);
}

if (env.NODE_ENV === "production" && !env.CLIENT_URL) {
    console.error("❌ Missing required environment variable: CLIENT_URL");
    process.exit(1);
}

if (!hasDatabaseUrl(env) && !hasLocalDbConfig(env)) {
    console.error(
        "❌ Database config missing. Set DATABASE_URL (Neon/production) or DB_HOST/DB_USER/DB_NAME (local)."
    );
    process.exit(1);
}

if (env.NODE_ENV === "production") {
    if (typeof env.JWT_SECRET !== "string" || env.JWT_SECRET.length < 32) {
        console.error("❌ JWT_SECRET must be set and at least 32 characters long in production.");
        process.exit(1);
    }
}

// Warn (don't crash) for optional-but-important vars
if (!env.GEMINI_API_KEY) {
    console.warn("⚠️  GEMINI_API_KEY not set — AI quiz generation will fail.");
}

if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn(
        "⚠️  Google OAuth not set — 'Continue with Google' will be disabled until GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are configured."
    );
}

export default env;