import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  getStudentTasks,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getAssignableStudents,
} from '../controllers/taskController.js';
import {
  getTaskMessages,
  sendTaskMessage,
  getUnreadCounts,
} from '../controllers/taskMessageController.js';

const router = Router();

// Student — get their assigned tasks
router.get('/my', requireAuth, getStudentTasks);

// Admin routes
router.get('/', requireAuth, requireAdmin, getAllTasks);
router.get('/assignable-students', requireAuth, requireAdmin, getAssignableStudents);
router.get('/:id', requireAuth, getTaskById);
router.post('/', requireAuth, requireAdmin, createTask);
router.put('/:id', requireAuth, requireAdmin, updateTask);
router.delete('/:id', requireAuth, requireAdmin, deleteTask);

// Discussion routes
router.get('/:taskId/messages', requireAuth, getTaskMessages);
router.post('/:taskId/messages', requireAuth, sendTaskMessage);
router.get('/:taskId/unread-counts', requireAuth, getUnreadCounts);

export default router;
