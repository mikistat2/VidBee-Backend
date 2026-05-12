// Handles quiz generation, sessions, answers, results, and history

import { randomUUID } from 'crypto';
import { getUploadById } from '../models/Upload.js';
import { getQuestionsByUpload } from '../models/Question.js';
import { createManyQuestions } from '../models/Question.js';
import { createSession, getSessionById, getSessionByShareToken, getSessionByUserAndShareSeed, getSessionsByUser, updateSessionScore } from '../models/QuizSession.js';
import { saveAnswer, getAnswersBySession } from '../models/Answer.js';
import { generateQuestions } from '../utils/quizGenerator.js';
import logger from '../utils/logger.js';

const MAX_TEXT_LENGTH = 50_000; // cap prompt size to control cost/latency

function shuffleWithSeed(items, seed) {
  const shuffled = [...items];
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function mapSessionPayload(session) {
  return {
    id:          session.id,
    upload_id:   session.upload_id,
    upload_name: session.upload_name,
    config:      session.config,
    share_token: session.share_token,
  };
}

async function getSharedSessionByKey(key) {
  const byToken = await getSessionByShareToken(key);
  if (byToken) return byToken;

  if (/^\d+$/.test(String(key))) {
    return getSessionById(Number(key));
  }

  return null;
}

async function buildQuizResponse(session, { publicView = false } = {}) {
  const fullQuestions = await getQuestionsByUpload(session.upload_id, session.config?.difficulty);
  const questions = fullQuestions.map((q) => ({
    id:             q.id,
    question:       q.question,
    options:        q.options,
    correct_answer: q.answer,
    difficulty:     q.difficulty,
    explanation:    q.explanation || null,
  }));

  const count = session.config?.questionCount || questions.length;
  const slicedQuestions = questions.slice(0, count);
  const seededQuestions = slicedQuestions.map((q) => ({
    ...q,
    options: Array.isArray(q.options) ? shuffleWithSeed(q.options, `${session.config?.shareSeed || session.id}:${q.id}`) : q.options,
  }));

  const answers = publicView ? await getAnswersBySession(session.id) : await getAnswersBySession(session.id);

  return {
    session: mapSessionPayload(session),
    questions: seededQuestions,
    answers,
  };
}

// ─── POST /api/quiz/generate ───────────────────────────────────────────────────
// Creates a quiz session: generates questions from the upload's extracted text
export async function generateQuiz(req, res) {
  try {
    const { uploadId, questionCount = 10, difficulty = 'medium', answerMode = 'immediate' } = req.body;

    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required.' });
    }

    // Verify upload exists and belongs to user
    const upload = await getUploadById(uploadId);
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    if (upload.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (!upload.extracted_text) {
      return res.status(422).json({ error: 'Upload has no extracted text.' });
    }

    // Check if we already have questions for this upload with the specified difficulty
    let existingQuestions = await getQuestionsByUpload(uploadId, difficulty);

    // If no questions exist yet, generate them via AI
    if (existingQuestions.length === 0) {
      const textForAI = upload.extracted_text.length > MAX_TEXT_LENGTH
        ? upload.extracted_text.slice(0, MAX_TEXT_LENGTH)
        : upload.extracted_text;

      const aiQuestions = await generateQuestions({
        text: textForAI,
        questionCount,
        difficulty,
      });

      if (!Array.isArray(aiQuestions) || aiQuestions.length === 0) {
        return res.status(502).json({ error: 'AI returned no questions. Please try again.' });
      }

      existingQuestions = await createManyQuestions(
        aiQuestions.map((q) => ({
          uploadId:   upload.id,
          userId:     req.user.id,
          question:   q.question,
          options:    q.options,
          answer:     q.answer,
          explanation: q.explanation ?? null,
          difficulty: q.difficulty ?? difficulty,
        }))
      );
    } else if (existingQuestions.length < questionCount) {
      // Generate additional questions if they want more than what exists
      const additionalCount = questionCount - existingQuestions.length;
      const textForAI = upload.extracted_text.length > MAX_TEXT_LENGTH
        ? upload.extracted_text.slice(0, MAX_TEXT_LENGTH)
        : upload.extracted_text;

      const aiQuestions = await generateQuestions({
        text: textForAI,
        questionCount: additionalCount,
        difficulty,
      });

      if (Array.isArray(aiQuestions) && aiQuestions.length > 0) {
        const newQuestions = await createManyQuestions(
          aiQuestions.map((q) => ({
            uploadId:   upload.id,
            userId:     req.user.id,
            question:   q.question,
            options:    q.options,
            answer:     q.answer,
            explanation: q.explanation ?? null,
            difficulty: q.difficulty ?? difficulty,
          }))
        );
        existingQuestions = [...existingQuestions, ...newQuestions];
      }
    }

    // Set the configured count to not exceed what we actually have
    const finalQuestionCount = Math.min(questionCount, existingQuestions.length);
    const shareSeed = randomUUID();
    const shareToken = randomUUID();

    // Create a quiz session
    const session = await createSession({
      userId:   req.user.id,
      uploadId: upload.id,
      config:   { questionCount: finalQuestionCount, difficulty, answerMode, shareSeed },
      shareToken,
    });

    logger.info(`Quiz session ${session.id} created — user: ${req.user.id}, upload: ${uploadId}`);

    res.status(201).json({ sessionId: session.id, shareToken: session.share_token });

  } catch (err) {
    logger.error('Quiz generation failed:', err);
    res.status(500).json({ error: 'Failed to generate quiz. Please try again.' });
  }
}

// ─── POST /api/quiz/share/:token/join ─────────────────────────────────────────
// Creates or reuses a personal session for the current user from a shared link
export async function joinSharedSession(req, res) {
  try {
    const sourceSession = await getSharedSessionByKey(req.params.token);
    if (!sourceSession) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const shareSeed = sourceSession.config?.shareSeed || sourceSession.share_token || req.params.token;

    if (sourceSession.user_id === req.user.id) {
      return res.json({ sessionId: sourceSession.id, shareToken: sourceSession.share_token });
    }

    const existingClone = await getSessionByUserAndShareSeed(req.user.id, shareSeed);
    if (existingClone) {
      return res.json({ sessionId: existingClone.id, shareToken: existingClone.share_token });
    }

    const clone = await createSession({
      userId: req.user.id,
      uploadId: sourceSession.upload_id,
      config: {
        ...sourceSession.config,
        shareSeed,
      },
      shareToken: randomUUID(),
    });

    logger.info(`Shared quiz ${sourceSession.id} joined by user ${req.user.id} as session ${clone.id}`);

    res.status(201).json({ sessionId: clone.id, shareToken: clone.share_token });
  } catch (err) {
    logger.error('Join shared session failed:', err);
    res.status(500).json({ error: 'Failed to join shared session.' });
  }
}

// ─── GET /api/quiz/share/:token ───────────────────────────────────────────────
// Returns a shared session + questions without requiring login
export async function getSharedSession(req, res) {
  try {
    const session = await getSharedSessionByKey(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const payload = await buildQuizResponse(session, { publicView: true });
    res.json(payload);
  } catch (err) {
    logger.error('Get shared session failed:', err);
    res.status(500).json({ error: 'Failed to load shared quiz session.' });
  }
}

// ─── GET /api/quiz/session/:id ─────────────────────────────────────────────────
// Returns session info + questions for quiz-taking
export async function getSession(req, res) {
  try {
    const session = await getSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    if (session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const payload = await buildQuizResponse(session);
    res.json(payload);
  } catch (err) {
    logger.error('Get session failed:', err);
    res.status(500).json({ error: 'Failed to load quiz session.' });
  }
}

// ─── GET /api/quiz/share/:token/results ───────────────────────────────────────
// Returns shared results without requiring login
export async function getSharedResults(req, res) {
  try {
    const session = await getSharedSessionByKey(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const payload = await getResultsPayload(session);
    res.json(payload);
  } catch (err) {
    logger.error('Get shared results failed:', err);
    res.status(500).json({ error: 'Failed to load shared results.' });
  }
}

// ─── POST /api/quiz/answer ─────────────────────────────────────────────────────
// Saves a single answer
export async function submitAnswer(req, res) {
  try {
    const { sessionId, questionId, answer: selectedAnswer } = req.body;

    if (!sessionId || !questionId || !selectedAnswer) {
      return res.status(400).json({ error: 'sessionId, questionId, and answer are required.' });
    }

    // Verify session belongs to user
    const session = await getSessionById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    if (session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Check if the answer is correct by looking up the question
    // Pass null for difficulty so we can find the question regardless of the session filter
    const questions = await getQuestionsByUpload(session.upload_id);
    const question = questions.find((q) => q.id === Number(questionId));

    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const isCorrect = selectedAnswer === question.answer;

    const saved = await saveAnswer({
      sessionId,
      questionId,
      selectedAnswer,
      isCorrect,
    });

    // Recalculate session score
    const allAnswers = await getAnswersBySession(sessionId);
    const correctCount = allAnswers.filter((a) => a.is_correct).length;
    const score = Math.round((correctCount / allAnswers.length) * 100);
    await updateSessionScore(sessionId, score);

    res.json({
      success: true,
      is_correct: isCorrect,
      correct_answer: session.config?.answerMode === 'immediate' ? question.answer : undefined,
      explanation: session.config?.answerMode === 'immediate' ? question.explanation : undefined,
    });
  } catch (err) {
    logger.error('Submit answer failed:', err);
    res.status(500).json({ error: 'Failed to submit answer.' });
  }
}

// ─── POST /api/quiz/share/:token/answer ───────────────────────────────────────
// Saves a single answer for a shared session
export async function submitSharedAnswer(req, res) {
  try {
    const { token } = req.params;
    const { questionId, answer: selectedAnswer } = req.body;

    if (!questionId || !selectedAnswer) {
      return res.status(400).json({ error: 'questionId and answer are required.' });
    }

    const session = await getSessionByShareToken(token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const questions = await getQuestionsByUpload(session.upload_id);
    const question = questions.find((q) => q.id === Number(questionId));

    if (!question) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const isCorrect = selectedAnswer === question.answer;

    await saveAnswer({
      sessionId: session.id,
      questionId,
      selectedAnswer,
      isCorrect,
    });

    const allAnswers = await getAnswersBySession(session.id);
    const correctCount = allAnswers.filter((a) => a.is_correct).length;
    const score = Math.round((correctCount / allAnswers.length) * 100);
    await updateSessionScore(session.id, score);

    res.json({
      success: true,
      is_correct: isCorrect,
      correct_answer: session.config?.answerMode === 'immediate' ? question.answer : undefined,
      explanation: session.config?.answerMode === 'immediate' ? question.explanation : undefined,
    });
  } catch (err) {
    logger.error('Submit shared answer failed:', err);
    res.status(500).json({ error: 'Failed to submit shared answer.' });
  }
}

// ─── GET /api/quiz/results/:id ─────────────────────────────────────────────────
// Returns full results for a completed quiz session
export async function getResults(req, res) {
  try {
    const session = await getSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    if (session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const payload = await getResultsPayload(session);
    res.json(payload);
  } catch (err) {
    logger.error('Get results failed:', err);
    res.status(500).json({ error: 'Failed to load results.' });
  }
}

async function getResultsPayload(session) {
  const questions = await getQuestionsByUpload(session.upload_id, session.config?.difficulty);
  const answers = await getAnswersBySession(session.id);

  const count = session.config?.questionCount || questions.length;
  const slicedQuestions = questions.slice(0, count);

  const questionsWithAnswers = slicedQuestions.map((q) => ({
    id:             q.id,
    question:       q.question,
    options:        Array.isArray(q.options) ? shuffleWithSeed(q.options, `${session.id}:${q.id}`) : q.options,
    correct_answer: q.answer,
    difficulty:     q.difficulty,
    explanation:    q.explanation || null,
  }));

  return {
    session: {
      id:          session.id,
      upload_id:   session.upload_id,
      upload_name: session.upload_name,
      score:       session.score,
      share_token: session.share_token,
      config:      session.config,
    },
    questions: questionsWithAnswers,
    answers,
  };
}

// ─── GET /api/quiz/history ─────────────────────────────────────────────────────
// Returns all quiz sessions for the current user
export async function getHistory(req, res) {
  try {
    const sessions = await getSessionsByUser(req.user.id);

    // Format for the client
    const formatted = sessions.map((s) => ({
      id:             s.id,
      upload_id:      s.upload_id,
      upload_name:    s.upload_name,
      file_type:      s.file_type,
      question_count: s.config?.questionCount || 10,
      difficulty:     s.config?.difficulty || 'medium',
      score:          s.score ?? 0,
      created_at:     s.created_at,
    }));

    res.json({ sessions: formatted });
  } catch (err) {
    logger.error('Get history failed:', err);
    res.status(500).json({ error: 'Failed to load history.' });
  }
}