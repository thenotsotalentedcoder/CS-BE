import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  submitTask,
  getTaskSubmissions,
  getSubmission,
  reviewSubmission,
} from '../controllers/submissionController.js';

const router = Router();

// Student — submit a task
router.post('/', requireAuth, submitTask);

// Admin — view all submissions for a task
router.get('/task/:taskId', requireAuth, requireAdmin, getTaskSubmissions);

// Shared — get single submission (admin or owner)
router.get('/:id', requireAuth, getSubmission);

// Admin — post feedback and mark reviewed
router.patch('/:id/review', requireAuth, requireAdmin, reviewSubmission);

export default router;
