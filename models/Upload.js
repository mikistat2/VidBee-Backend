import db from '../config/db.js';

// ─── Create ────────────────────────────────────────────────────────────────────

export async function createUpload({ userId, fileName, fileSize, fileType, extractedText, status = 'processing' }) {
  const result = await db.query(
    `INSERT INTO uploads 
      (user_id, file_name, file_size, file_type, extracted_text, status)
     VALUES 
      ($1, $2, $3, $4, $5, $6)
     RETURNING 
      id, user_id, file_name, file_size, file_type, extracted_text, status, created_at`,
    [userId, fileName, fileSize, fileType, extractedText, status]
  );
  return result.rows[0];
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getUploadById(id) {
  const result = await db.query(
    `SELECT 
      id, user_id, file_name, file_size, file_type, extracted_text, status, created_at
     FROM uploads 
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;  // explicit null instead of undefined
}

export async function getUploadsByUser(userId) {
  const result = await db.query(
    `SELECT 
      id, file_name, file_size, file_type, status, created_at
     FROM uploads
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// Get recent uploads for a user (for the home page)
export async function getRecentUploadsByUser(userId, limit = 10) {
  const result = await db.query(
    `SELECT 
      u.id,
      u.file_name AS original_name,
      u.file_type,
      u.file_size,
      u.status,
      u.created_at,
      COUNT(DISTINCT qs.id)::int AS quiz_count
     FROM uploads u
     LEFT JOIN quiz_sessions qs ON qs.upload_id = u.id
     WHERE u.user_id = $1 AND u.status = 'done'
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

// ─── Update ────────────────────────────────────────────────────────────────────

export async function updateUploadStatus(id, status) {
  const result = await db.query(
    `UPDATE uploads 
     SET status = $1
     WHERE id = $2
     RETURNING id, status`,
    [status, id]
  );
  return result.rows[0] ?? null;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export async function deleteUpload(id) {
  await db.query(
    `DELETE FROM uploads WHERE id = $1`,
    [id]
  );
}