import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getDashboardStats,
  importAllowlist,
  addAllowedEmail,
  getAllowlist,
  updateUserRole,
} from '../controllers/adminController.js';

const router = Router();

// GET /api/admin/stats — overview dashboard counts
router.get('/stats', requireAuth, requireAdmin, getDashboardStats);

// Role management
router.patch('/users/:id/role', requireAuth, requireAdmin, updateUserRole);

// Allowlist management
router.get('/allowlist', requireAuth, requireAdmin, getAllowlist);
router.post('/allowlist/import', requireAuth, requireAdmin, importAllowlist);
router.post('/allowlist', requireAuth, requireAdmin, addAllowedEmail);

export default router;
