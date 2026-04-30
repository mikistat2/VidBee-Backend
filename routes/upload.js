// Upload routes
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadFile, getRecentUploads, getUpload } from '../controllers/uploadController.js';
import authenticate from '../middleware/auth.js';

const router = Router();

// ─── Multer config ──────────────────────────────────────────────────────────
// Store uploaded files temporarily in server/uploads/ before processing
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// All upload routes require authentication
router.use(authenticate);

// POST /api/upload   — upload a document file
router.post('/', upload.single('file'), uploadFile);

// GET /api/upload/recent — recent uploads for current user
router.get('/recent', getRecentUploads);

// GET /api/upload/:id — single upload details
router.get('/:id', getUpload);

export default router;