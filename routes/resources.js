import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getPublicResources,
  getStudentResources,
  createResource,
  updateResource,
  deleteResource,
  saveResource,
  unsaveResource,
  getSavedResources,
} from '../controllers/resourceController.js';

const router = Router();

// Public — no auth required
router.get('/public', getPublicResources);

// Student routes
router.get('/', requireAuth, getStudentResources);
router.post('/:id/save', requireAuth, saveResource);
router.delete('/:id/save', requireAuth, unsaveResource);
router.get('/saved', requireAuth, getSavedResources);

// Admin routes
router.post('/', requireAuth, requireAdmin, createResource);
router.put('/:id', requireAuth, requireAdmin, updateResource);
router.delete('/:id', requireAuth, requireAdmin, deleteResource);

export default router;
