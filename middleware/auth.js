// Auth middleware (JWT verification)
// Protects routes by verifying the Bearer token from the Authorization header.

import jwt from "jsonwebtoken";
import env from "../config/env.js";

export default function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    // Attach user payload to request so downstream handlers can use it
    req.user = { id: decoded.id, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}
