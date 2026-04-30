import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import db from "../config/db.js";
import env from "../config/env.js";

const saltRound = 10;

// ─── Helper: find user by email ─────────────────────────────────────────────
async function findUserByEmail(email) {
  const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] || null;
}

// ─── Helper: create user ────────────────────────────────────────────────────
async function createUser({ firstName, lastName, email, password }) {
  const { rows } = await db.query(
    "INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *",
    [firstName, lastName, email, password]
  );
  return rows[0];
}

// ─── Helper: sign JWT ───────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

// ─── Helper: strip password from user object ────────────────────────────────
function safeUser(user) {
  const { password, ...rest } = user;
  return rest;
}

// ─── POST /api/auth/register ────────────────────────────────────────────────
export async function register(req, res) {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const hashed = await bcrypt.hash(password, saltRound);
    const user = await createUser({ firstName, lastName, email, password: hashed });
    const token = signToken(user);

    return res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Registration failed." });
  }
}

// ─── POST /api/auth/login ───────────────────────────────────────────────────
export async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = signToken(user);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed." });
  }
}

// ─── GET /api/auth/me ───────────────────────────────────────────────────────
export async function getMe(req, res) {
  try {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json({ user: safeUser(user) });
  } catch (err) {
    console.error("getMe error:", err);
    return res.status(500).json({ error: "Failed to fetch user." });
  }
}

// ─── POST /api/auth/google/token (native mobile Google sign-in) ─────────────
export async function googleNativeToken(req, res) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: "Missing idToken." });
    }

    if (!env.GOOGLE_CLIENT_ID) {
      return res.status(501).json({ error: "Google OAuth is not configured on this server." });
    }

    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;

    if (!email) {
      return res.status(400).json({ error: "Google account has no email." });
    }

    const firstName = payload?.given_name || email.split("@")[0] || "User";
    const lastName = payload?.family_name || "Google";

    let user = await findUserByEmail(email);
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const hashed = await bcrypt.hash(randomPassword, saltRound);
      user = await createUser({ firstName, lastName, email, password: hashed });
    }

    const token = signToken(user);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error("Google native token error:", err);
    return res.status(401).json({ error: "Invalid Google token." });
  }
}

// ─── Google OAuth helpers ───────────────────────────────────────────────────
// In-memory state store with TTL for CSRF protection
const oauthState = new Map();

function cleanupExpiredOAuthState() {
  const now = Date.now();
  for (const [key, { expiresAt }] of oauthState) {
    if (now > expiresAt) oauthState.delete(key);
  }
}

function getOAuthClient() {
  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALLBACK_URL
  );
}

// ─── GET /auth/google ───────────────────────────────────────────────────────
export function googleAuthStart(req, res) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ error: "Google OAuth is not configured on this server." });
  }

  const state = crypto.randomBytes(32).toString("hex");
  oauthState.set(state, { expiresAt: Date.now() + 10 * 60 * 1000 }); // 10 min TTL
  cleanupExpiredOAuthState();

  const client = getOAuthClient();
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

  return res.redirect(authUrl);
}

// ─── GET /auth/google/callback ──────────────────────────────────────────────
export async function googleAuthCallback(req, res) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent(String(error))}`);
    }

    if (!code) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent("Missing authorization code")}`);
    }

    cleanupExpiredOAuthState();
    if (!state || !oauthState.has(String(state))) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent("Invalid OAuth state")}`);
    }
    oauthState.delete(String(state));

    const client = getOAuthClient();
    const { tokens } = await client.getToken(String(code));

    if (!tokens?.id_token) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent("Missing id_token from Google")}`);
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;

    if (!email) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent("Google account has no email")}`);
    }

    const firstName = payload?.given_name || email.split("@")[0] || "User";
    const lastName = payload?.family_name || "Google";

    let user = await findUserByEmail(email);
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString("hex");
      const hashed = await bcrypt.hash(randomPassword, saltRound);
      user = await createUser({ firstName, lastName, email, password: hashed });
    }

    const token = signToken(user);

    return res.redirect(
      `${env.CLIENT_URL}/oauth/google/callback?token=${encodeURIComponent(token)}`
    );
  } catch (err) {
    console.error("Google auth callback error:", err);
    return res.redirect(
      `${env.CLIENT_URL}/auth?error=${encodeURIComponent("Google login failed")}`
    );
  }
}