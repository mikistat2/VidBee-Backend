import path from 'path';
import fs from 'fs/promises';
import { createUpload, updateUploadStatus, getUploadById, getRecentUploadsByUser } from '../models/Upload.js';
import { extractTextFromFile } from '../utils/fileParser.js';
import { generateQuestions } from '../utils/quizGenerator.js';
import { createManyQuestions } from '../models/Question.js';
import logger from '../utils/logger.js';

// ─── Config ────────────────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS  = ['pdf', 'docx', 'pptx'];
const ALLOWED_MIME_TYPES  = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MIN_TEXT_LENGTH     = 100;               // reject files with barely any text
const MAX_TEXT_LENGTH     = 50_000;            // cap to avoid huge AI bills

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Always clean up temp file from disk after processing
async function deleteTempFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    logger.warn(`Failed to delete temp file: ${filePath}`, err.message);
  }
}

function getExtension(filename) {
  return path.extname(filename).replace('.', '').toLowerCase();
}

// ─── Controller ────────────────────────────────────────────────────────────────

// POST /api/upload
export async function uploadFile(req, res) {
  let upload = null;
  const filePath = req.file?.path;

  try {

    // ── 1. File presence check ──────────────────────────────────────────────
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // ── 2. File size check ──────────────────────────────────────────────────
    if (req.file.size > MAX_FILE_SIZE_BYTES) {
      await deleteTempFile(filePath);
      return res.status(400).json({ error: 'File exceeds 10MB limit.' });
    }

    // ── 3. Extension + MIME type double check ───────────────────────────────
    const ext = getExtension(req.file.originalname);

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      await deleteTempFile(filePath);
      return res.status(400).json({ error: `Unsupported file type ".${ext}". Allowed: PDF, DOCX, PPTX.` });
    }

    if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
      await deleteTempFile(filePath);
      return res.status(400).json({ error: 'File MIME type does not match its extension.' });
    }

    // ── 4. Extract text ─────────────────────────────────────────────────────
    let extractedText;
    try {
      extractedText = await extractTextFromFile(filePath, ext);
    } catch (parseErr) {
      await deleteTempFile(filePath);
      logger.error('Text extraction failed:', parseErr);
      return res.status(422).json({ error: 'Could not read file content. File may be corrupted.' });
    }

    // ── 5. Text quality checks ──────────────────────────────────────────────
    const trimmedText = extractedText?.trim();

    if (!trimmedText || trimmedText.length < MIN_TEXT_LENGTH) {
      await deleteTempFile(filePath);
      return res.status(422).json({ error: 'File has too little readable text to generate a quiz.' });
    }

    // ── 6. Save upload record with status 'done' ────────────────────────────
    // Note: We save as 'done' immediately since text extraction succeeded.
    // Quiz generation happens later when user clicks "Generate quiz" on configure page.
    upload = await createUpload({
      userId:        req.user.id,
      fileName:      req.file.originalname,
      fileSize:      req.file.size,
      fileType:      ext,
      // Save FULL extracted text in DB. We still cap what we send to the AI later
      // (in quiz generation) to avoid huge prompt sizes.
      extractedText: trimmedText,
      status:        'done',
    });

    // ── 7. Clean up temp file (no longer needed) ────────────────────────────
    await deleteTempFile(filePath);

    logger.info(`Upload complete — user: ${req.user.id}, file: ${req.file.originalname}`);

    // ── 8. Respond ─────────────────────────────────────────────────────────
    return res.status(201).json({
      message:   'File uploaded successfully.',
      uploadId:  upload.id,
      fileName:  req.file.originalname,
    });

  } catch (err) {
    // Catch-all — mark upload as failed if it was already created
    if (upload?.id) {
      await updateUploadStatus(upload.id, 'failed').catch(() => {});
    }

    // Clean up temp file if still on disk
    if (filePath) {
      await deleteTempFile(filePath);
    }

    logger.error('Unexpected upload error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// GET /api/upload/recent
export async function getRecentUploads(req, res) {
  try {
    const uploads = await getRecentUploadsByUser(req.user.id);
    res.json({ uploads });
  } catch (err) {
    logger.error('Failed to fetch recent uploads:', err);
    res.status(500).json({ error: 'Failed to fetch uploads.' });
  }
}

// GET /api/upload/:id
export async function getUpload(req, res) {
  try {
    const upload = await getUploadById(req.params.id);
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found.' });
    }
    // Only allow the owner to view their upload
    if (upload.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    res.json({
      upload: {
        id:            upload.id,
        original_name: upload.file_name,
        file_type:     upload.file_type,
        file_size:     upload.file_size,
        status:        upload.status,
        created_at:    upload.created_at,
      },
    });
  } catch (err) {
    logger.error('Failed to fetch upload:', err);
    res.status(500).json({ error: 'Failed to fetch upload.' });
  }
}