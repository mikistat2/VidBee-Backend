// Auth routes
import { Router } from 'express';
import { register, login, getMe, googleTokenLogin } from '../controllers/authController.js';
import authenticate from '../middleware/auth.js';

const router = Router();

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// GET /api/auth/me  (protected — validates token and returns user data)
router.get('/me', authenticate, getMe);

// POST /api/auth/google/token (for native mobile plugins)
router.post('/google/token', googleTokenLogin);

export default router;