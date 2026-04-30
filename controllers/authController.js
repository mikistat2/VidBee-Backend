// Handles user authentication (register, login, getMe)
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { createUser, findUserByEmail, findUserById } from '../models/User.js';
import env from '../config/env.js';

const saltRound = 10;

// In-memory state store for OAuth CSRF protection (dev-friendly)
// NOTE: This resets on server restart.
const oauthState = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanupExpiredOAuthState() {
  const now = Date.now();
  for (const [key, createdAt] of oauthState.entries()) {
    if (now - createdAt > OAUTH_STATE_TTL_MS) oauthState.delete(key);
  }
}

function getOAuthClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_CALLBACK_URL);
}

// Helper to generate JWT
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

// Helper to format user for client (keep snake_case — matches UI components)
function formatUser(user) {
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
  };
}

// POST /api/auth/register
export async function register(req, res) {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    const hashed = await bcrypt.hash(password, saltRound);
    const user = await createUser({ firstName, lastName, email, password: hashed });
    const token = signToken(user);
    res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
}

// POST /api/auth/login
export async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required.' });
    }
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const token = signToken(user);
    res.json({ token, user: formatUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
}

// GET /api/auth/me  (protected — requires auth middleware)
export async function getMe(req, res) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user: formatUser(user) });
  } catch (err) {
    console.error('GetMe error:', err);
    res.status(500).json({ error: 'Failed to fetch user.' });
  }
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

// GET /auth/google
export async function googleAuthStart(_req, res) {
  try {
    cleanupExpiredOAuthState();
    const state = crypto.randomBytes(24).toString('hex');
    oauthState.set(state, Date.now());

    const client = getOAuthClient();
    const url = client.generateAuthUrl({
      access_type: 'online',
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state,
    });

    return res.redirect(url);
  } catch (err) {
    console.error('Google auth start error:', err);
    return res.status(500).send('Failed to start Google authentication.');
  }
}

// GET /auth/google/callback
export async function googleAuthCallback(req, res) {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent(String(error))}`);
    }

    if (!code) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Missing authorization code')}`);
    }

    cleanupExpiredOAuthState();
    if (!state || !oauthState.has(String(state))) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Invalid OAuth state')}`);
    }
    oauthState.delete(String(state));

    const client = getOAuthClient();
    const { tokens } = await client.getToken(String(code));

    if (!tokens?.id_token) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Missing id_token from Google')}`);
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;

    if (!email) {
      return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Google account has no email')}`);
    }

    const firstName = payload?.given_name || email.split('@')[0] || 'User';
    const lastName = payload?.family_name || 'Google';

    let user = await findUserByEmail(email);
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashed = await bcrypt.hash(randomPassword, saltRound);
      user = await createUser({ firstName, lastName, email, password: hashed });
    }

    const token = signToken(user);
    // Redirect back to the client with token
    return res.redirect(`${env.CLIENT_URL}/oauth/google/callback?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google auth callback error:', err);
    return res.redirect(`${env.CLIENT_URL}/auth?error=${encodeURIComponent('Google login failed')}`);
  }
}