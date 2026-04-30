// Result routes — forwarded to quiz controller
import { Router } from 'express';
import { getResults } from '../controllers/quizController.js';
import authenticate from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// GET /api/result/:id — same as /api/quiz/results/:id, alternative path
router.get('/:id', getResults);

export default router;