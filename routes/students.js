import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getAllStudents,
  getStudentProfile,
  assignGroup,
} from '../controllers/studentController.js';

const router = Router();

// Admin — list all students
router.get('/', requireAuth, requireAdmin, getAllStudents);

// Admin — individual student profile (tasks, submissions, feedback history)
router.get('/:id/profile', requireAuth, requireAdmin, getStudentProfile);

// Admin — assign group to student
router.patch('/:id/group', requireAuth, requireAdmin, assignGroup);

export default router;
