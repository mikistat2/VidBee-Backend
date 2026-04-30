// Handles quiz generation, sessions, answers, results, and history

import { getUploadById } from '../models/Upload.js';
import { getQuestionsByUpload, getQuizQuestions } from '../models/Question.js';
import { createManyQuestions } from '../models/Question.js';
import { createSession, getSessionById, getSessionsByUser, updateSessionScore } from '../models/QuizSession.js';
import { saveAnswer, getAnswersBySession } from '../models/Answer.js';
import { generateQuestions } from '../utils/quizGenerator.js';
import logger from '../utils/logger.js';

const MAX_TEXT_LENGTH = 50_000; // cap prompt size to control cost/latency

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

    // Create a quiz session
    const session = await createSession({
      userId:   req.user.id,
      uploadId: upload.id,
      config:   { questionCount: finalQuestionCount, difficulty, answerMode },
    });

    logger.info(`Quiz session ${session.id} created — user: ${req.user.id}, upload: ${uploadId}`);

    res.status(201).json({ sessionId: session.id });

  } catch (err) {
    logger.error('Quiz generation failed:', err);
    res.status(500).json({ error: 'Failed to generate quiz. Please try again.' });
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

    const answerMode = session.config?.answerMode || 'immediate';

    // For immediate mode, we need full questions (with correct_answer) so the
    // client can show instant feedback. For end mode, strip answers for security.
    let questions;
    if (answerMode === 'immediate') {
      const fullQuestions = await getQuestionsByUpload(session.upload_id, session.config?.difficulty);
      questions = fullQuestions.map((q) => ({
        id:             q.id,
        question:       q.question,
        options:        q.options,
        correct_answer: q.answer,
        difficulty:     q.difficulty,
        explanation:    q.explanation || null,
      }));
    } else {
      questions = await getQuizQuestions(session.upload_id, session.config?.difficulty);
    }

    // Get the configured question count and slice if needed
    const count = session.config?.questionCount || questions.length;
    const slicedQuestions = questions.slice(0, count);

    // Shuffle options to prevent pattern guessing
    slicedQuestions.forEach(q => {
      if (Array.isArray(q.options)) {
        q.options = q.options.sort(() => Math.random() - 0.5);
      }
    });

    res.json({
      session: {
        id:          session.id,
        upload_id:   session.upload_id,
        upload_name: session.upload_name,
        config:      session.config,
      },
      questions: slicedQuestions,
    });
  } catch (err) {
    logger.error('Get session failed:', err);
    res.status(500).json({ error: 'Failed to load quiz session.' });
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

    const questions = await getQuestionsByUpload(session.upload_id, session.config?.difficulty);
    const answers = await getAnswersBySession(session.id);

    // If they generated less than the total pool, only return the questions they actually saw.
    // In immediate mode they are ordered by created_at, but we should match what getSession did.
    // However, if we shuffle in getSession, we only reliably know they saw what they answered
    // OR just slice the exact same way if we assume deterministic ordering.
    // For now, let's just slice the same way `getSession` does based on the config.
    const count = session.config?.questionCount || questions.length;
    const slicedQuestions = questions.slice(0, count);

    // Map questions to include correct_answer for the results view
    const questionsWithAnswers = slicedQuestions.map((q) => ({
      id:             q.id,
      question:       q.question,
      options:        q.options,
      correct_answer: q.answer,
      difficulty:     q.difficulty,
      explanation:    q.explanation || null,
    }));

    res.json({
      session: {
        id:          session.id,
        upload_id:   session.upload_id,
        upload_name: session.upload_name,
        score:       session.score,
      },
      questions: questionsWithAnswers,
      answers,
    });
  } catch (err) {
    logger.error('Get results failed:', err);
    res.status(500).json({ error: 'Failed to load results.' });
  }
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