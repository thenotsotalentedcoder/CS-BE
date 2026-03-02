import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getNotifications,
  markRead,
  markAllRead,
} from '../controllers/notificationController.js';

const router = Router();

// GET /api/notifications — list for logged-in user (newest first)
router.get('/', requireAuth, getNotifications);

// PATCH /api/notifications/:id/read — mark single notification as read
router.patch('/:id/read', requireAuth, markRead);

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', requireAuth, markAllRead);

export default router;
