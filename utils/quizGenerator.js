import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import logger from './logger.js';

// ─── Config ────────────────────────────────────────────────────────────────────

// Lazy init — don't crash at import time if key is missing (supports mock mode)
let client = null;

function getClient() {
  // The @google/genai SDK reads GEMINI_API_KEY from env when not provided.
  // We still validate here to give a clear error early.
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY must be defined in environment variables to generate quizzes.');
  }

  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  return client;
}

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
const DEFAULT_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 30;

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

// ─── Prompt Builder ────────────────────────────────────────────────────────────

function buildPrompt({ text, questionCount, difficulty }) {
  return `You are a quiz generator. Analyze the following text and generate exactly ${questionCount} multiple choice questions.

Difficulty level: ${difficulty}
- easy:   straightforward recall questions, obvious wrong answers
- medium: require understanding, plausible wrong answers  
- hard:   require deep understanding, very similar wrong answers

Rules:
1. Each question must have exactly 4 options labeled A, B, C, D
2. Only one option is correct
3. The "answer" field must be the EXACT text of the correct option (not "A" or "B")
4. Questions must be based ONLY on the provided text
5. Do not repeat similar questions
6. Return ONLY valid JSON — no explanation, no markdown, no backticks
7. INCLUDE ALL THE CONCEPT FROM ALL THE TEXT. DO NOT OMIT ANY CONCEPT. IF YOU OMIT ANY CONCEPT, THE USER WILL NOT BE ABLE TO LEARN FROM THE QUIZ. DO NOT OMIT ANY CONCEPT. DO NOT OMIT ANY CONCEPT.
8. For EVERY question, include an "explanation" string: a simple 1-2 sentence explanation of WHY the correct answer is right

Return this exact JSON structure:
{
  "questions": [
    {
      "question": "Question text here?",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "answer": "Option A text",
      "difficulty": "${difficulty}",
      "explanation": "This is why Option A is right because..."
    }
  ]
}

Text to generate questions from:
"""
${text}
"""`;
}

// ─── Response Parser ───────────────────────────────────────────────────────────

function parseAIResponse(content) {
  // Strip markdown code fences if AI ignores instructions
  const cleaned = content
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI returned invalid JSON — could not parse response.');
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('AI response missing "questions" array.');
  }

  return parsed.questions;
}

function getResponseText(response) {
  // @google/genai typically exposes a convenient `.text` string getter.
  // Keep fallbacks to be resilient across SDK updates.
  if (typeof response?.text === 'string') return response.text;
  if (typeof response?.text === 'function') return response.text();

  const candidate = response?.response?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text)
    .filter(Boolean)
    .join('');

  return candidate || '';
}

// ─── Validator ─────────────────────────────────────────────────────────────────

function validateQuestions(questions) {
  const valid = [];
  const invalid = [];

  for (const [i, q] of questions.entries()) {
    const issues = [];

    // Normalize basic strings (keep it conservative: trim only)
    if (typeof q.question === 'string') q.question = q.question.trim();
    if (typeof q.answer === 'string') q.answer = q.answer.trim();
    if (Array.isArray(q.options)) {
      q.options = q.options.map((opt) => (typeof opt === 'string' ? opt.trim() : String(opt)));
    }

    // Normalize explanation to a single string (why the correct answer is right)
    if (q.explanation && typeof q.explanation === 'object' && !Array.isArray(q.explanation)) {
      // Backward-compat: if model returns { correct: "..." }, keep just the correct string
      if (typeof q.explanation.correct === 'string') {
        q.explanation = q.explanation.correct;
      } else {
        q.explanation = '';
      }
    }

    if (typeof q.explanation !== 'string') {
      q.explanation = '';
    }

    q.explanation = q.explanation.trim() || 'This is correct because it matches the information given in the text.';

    if (!q.question?.trim())                   issues.push('missing question text');
    if (!Array.isArray(q.options))             issues.push('options is not an array');
    if (q.options?.length !== 4)               issues.push(`expected 4 options, got ${q.options?.length}`);
    if (!q.answer?.trim())                     issues.push('missing answer');
    if (!q.options?.includes(q.answer))        issues.push('answer not found in options');
    if (!VALID_DIFFICULTIES.includes(q.difficulty)) issues.push('invalid difficulty');

    if (Array.isArray(q.options) && new Set(q.options).size !== q.options.length) {
      issues.push('duplicate options');
    }

    // explanation is normalized above; no extra validation needed here

    if (issues.length > 0) {
      invalid.push({ index: i, issues });
    } else {
      valid.push(q);
    }
  }

  if (invalid.length > 0) {
    logger.warn(`Filtered out ${invalid.length} invalid questions:`, JSON.stringify(invalid));
  }

  return valid;
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildBalancedTargets(length) {
  const targets = [];
  for (let i = 0; i < length; i++) targets.push(i % 4);
  return shuffleInPlace(targets);
}

function shuffleAndBalanceAnswerPositions(questions) {
  // 1) Shuffle options within each question (kills predictable LLM ordering)
  for (const q of questions) {
    q.options = shuffleInPlace([...q.options]);
  }

  // 2) Make correct option positions evenly distributed across A/B/C/D,
  // but randomized for each quiz generation.
  const targets = buildBalancedTargets(questions.length);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answerIndex = q.options.indexOf(q.answer);
    if (answerIndex === -1) continue;

    const targetIndex = targets[i];
    if (answerIndex === targetIndex) continue;

    [q.options[targetIndex], q.options[answerIndex]] = [q.options[answerIndex], q.options[targetIndex]];
  }

  return questions;
}

// ─── Main Export ───────────────────────────────────────────────────────────────

export async function generateQuestions({
  text,
  questionCount = DEFAULT_QUESTION_COUNT,
  difficulty = 'medium',
}) {

  // ── 1. Input validation ───────────────────────────────────────────────────
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided to generate questions from.');
  }

  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new Error(`Invalid difficulty "${difficulty}". Must be easy, medium, or hard.`);
  }

  const count = Math.min(
    Math.max(1, parseInt(questionCount, 10) || DEFAULT_QUESTION_COUNT),
    MAX_QUESTION_COUNT
  );

  // ── 2. Call Gemini API ───────────────────────────────────────────────────
  logger.info(`Generating ${count} ${difficulty} questions...`);

  let response;
  try {
    response = await getClient().models.generateContent({
      model: DEFAULT_MODEL,
      contents: buildPrompt({ text, questionCount: count, difficulty }),
    });
  } catch (err) {
    const msg = err?.message || String(err);
    logger.error('Gemini API call failed:', msg);
    if (err?.stack) logger.error(err.stack);
    throw new Error('AI service unavailable. Please try again later.');
  }

  // ── 3. Extract text content from response ─────────────────────────────────
  const rawContent = getResponseText(response);

  if (!rawContent) {
    throw new Error('AI returned an empty response.');
  }

  // ── 4. Parse JSON ─────────────────────────────────────────────────────────
  const questions = parseAIResponse(rawContent);

  // ── 5. Validate each question ─────────────────────────────────────────────
  const validQuestions = validateQuestions(questions);

  if (validQuestions.length === 0) {
    throw new Error('AI generated no valid questions. Please try again.');
  }

  // ── 6. Randomize + balance correct answer positions ──────────────────────
  shuffleAndBalanceAnswerPositions(validQuestions);

  logger.info(`Successfully generated ${validQuestions.length}/${count} valid questions.`);

  return validQuestions;
}