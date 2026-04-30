import db from '../config/db.js';

// ─── Create ────────────────────────────────────────────────────────────────────

// Insert multiple questions at once (used after AI generates them)
export async function createManyQuestions(questions) {
  if (!questions || questions.length === 0) return [];

  // Build dynamic parameterized query
  // Each question has 7 fields so params go ($1..$7), ($8..$14) etc
  const values = [];
  const placeholders = questions.map((q, i) => {
    const base = i * 7;
    values.push(
      q.uploadId,
      q.userId,
      q.question,
      JSON.stringify(q.options), // store options array as JSON
      q.answer,
      q.explanation ? JSON.stringify(q.explanation) : null,
      q.difficulty ?? 'medium'
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5}, $${base + 6}::jsonb, $${base + 7})`;
  });

  const result = await db.query(
    `INSERT INTO questions (upload_id, user_id, question, options, answer, explanation, difficulty)
     VALUES ${placeholders.join(', ')}
     RETURNING id, upload_id, user_id, question, options, answer, explanation, difficulty, created_at`,
    values
  );

  return result.rows.map(parseQuestion);
}

// ─── Read ──────────────────────────────────────────────────────────────────────

// Get a single question by id
export async function getQuestionById(id) {
  const result = await db.query(
    `SELECT id, upload_id, user_id, question, options, answer, explanation, difficulty, created_at
     FROM questions
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? parseQuestion(result.rows[0]) : null;
}

// Get all questions for a specific upload
export async function getQuestionsByUpload(uploadId, difficulty = null) {
  let query = `SELECT id, upload_id, user_id, question, options, answer, explanation, difficulty, created_at
     FROM questions
     WHERE upload_id = $1`;
  const params = [uploadId];

  if (difficulty) {
    query += ` AND difficulty = $2`;
    params.push(difficulty);
  }

  query += ` ORDER BY created_at ASC`;

  const result = await db.query(query, params);
  return result.rows.map(parseQuestion);
}

// Get questions for a quiz session — strips the answer out so
// the frontend never sees the correct answer during the quiz
export async function getQuizQuestions(uploadId, difficulty = null) {
  let query = `SELECT id, question, options, difficulty
     FROM questions
     WHERE upload_id = $1`;
  const params = [uploadId];

  if (difficulty) {
    query += ` AND difficulty = $2`;
    params.push(difficulty);
  }

  query += ` ORDER BY RANDOM()`;

  const result = await db.query(query, params);
  return result.rows.map(row => ({
    ...row,
    options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options,
  }));
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export async function deleteQuestionsByUpload(uploadId) {
  await db.query(
    `DELETE FROM questions WHERE upload_id = $1`,
    [uploadId]
  );
}

// ─── Helper ────────────────────────────────────────────────────────────────────

// options comes back from postgres as a string — always parse it
function parseQuestion(row) {
  let explanation = row.explanation;
  if (typeof explanation === 'string') {
    const trimmed = explanation.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        explanation = JSON.parse(trimmed);
      } catch {
        // Leave as string if parsing fails
        explanation = row.explanation;
      }
    }
  }

  return {
    ...row,
    options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options,
    explanation,
  };
}