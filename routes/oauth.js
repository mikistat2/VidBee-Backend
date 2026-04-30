import { Router } from 'express';
import { googleAuthStart, googleAuthCallback } from '../controllers/authController.js';

const router = Router();

// Matches Google Console callback config:
// - Start:    GET /auth/google
// - Callback: GET /auth/google/callback
router.get('/google', googleAuthStart);
router.get('/google/callback', googleAuthCallback);

export default router;
