import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getChatHistory, sendMessage, clearHistory } from '../controllers/chatController.js';

const router = Router();

router.get('/history', requireAuth, getChatHistory);
router.post('/', requireAuth, sendMessage);
router.delete('/history', requireAuth, clearHistory);

export default router;
