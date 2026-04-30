// Auth routes
import { Router } from 'express';
import { register, login, getMe, googleNativeToken } from '../controllers/authController.js';
import authenticate from '../middleware/auth.js';

const router = Router();

// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/google/token  (native mobile Google sign-in)
router.post('/google/token', googleNativeToken);

// GET /api/auth/me  (protected — validates token and returns user data)
router.get('/me', authenticate, getMe);

export default router;