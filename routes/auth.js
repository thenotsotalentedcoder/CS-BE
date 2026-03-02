import { Router } from 'express';
import { checkEmail, signup, getMe } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/check-email
router.post('/check-email', checkEmail);

// POST /api/auth/signup
router.post('/signup', signup);

// GET /api/auth/me — returns logged-in user's DB row
router.get('/me', requireAuth, getMe);

export default router;
