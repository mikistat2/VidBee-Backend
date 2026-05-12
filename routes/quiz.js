// Quiz routes
import { Router } from 'express';
import { generateQuiz, getSession, getSharedSession, joinSharedSession, submitAnswer, submitSharedAnswer, getResults, getSharedResults, getHistory } from '../controllers/quizController.js';
import authenticate from '../middleware/auth.js';

const router = Router();

// Public share routes — accessible by token without logging in
router.get('/share/:token', getSharedSession);
router.get('/share/:token/results', getSharedResults);

// All quiz routes require authentication
router.use(authenticate);

router.post('/share/:token/join', joinSharedSession);
router.post('/share/:token/answer', submitSharedAnswer);

// POST /api/quiz/generate — create quiz session + generate questions
router.post('/generate', generateQuiz);

// GET /api/quiz/session/:id — get session + questions for quiz-taking
router.get('/session/:id', getSession);

// POST /api/quiz/answer — submit a single answer
router.post('/answer', submitAnswer);

// GET /api/quiz/results/:id — get full results for a session
router.get('/results/:id', getResults);

// GET /api/quiz/history — list all quiz sessions for current user
router.get('/history', getHistory);

export default router;