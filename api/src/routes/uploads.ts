import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { uploadService } from '../services/uploadService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// ─── Multer Configuration ─────────────────────────────────────

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP`));
    }
  },
});

// ─── Validation Schemas ───────────────────────────────────────

const reorderSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1),
});

// ─── POST /api/uploads/avatar ─────────────────────────────────

router.post(
  '/avatar',
  authMiddleware as any,
  writeLimiter,
  upload.single('file'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const result = await uploadService.uploadAvatar(req.user.id, req.file);

    res.json({
      success: true,
      data: result,
      message: 'Avatar uploaded successfully.',
    });
  })
);

// ─── POST /api/uploads/portfolio ──────────────────────────────

router.post(
  '/portfolio',
  authMiddleware as any,
  writeLimiter,
  upload.single('file'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const caption = typeof req.body.caption === 'string' ? req.body.caption : undefined;
    const photo = await uploadService.uploadPortfolioPhoto(
      req.user.id,
      req.file,
      caption
    );

    res.status(201).json({
      success: true,
      data: photo,
      message: 'Portfolio photo uploaded successfully.',
    });
  })
);

// ─── DELETE /api/uploads/portfolio/:photoId ───────────────────

router.delete(
  '/portfolio/:photoId',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { photoId } = req.params;

    await uploadService.deletePortfolioPhoto(req.user.id, photoId);

    res.json({
      success: true,
      message: 'Portfolio photo deleted successfully.',
    });
  })
);

// ─── PUT /api/uploads/portfolio/reorder ───────────────────────

router.put(
  '/portfolio/reorder',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { photoIds } = reorderSchema.parse(req.body);

    const photos = await uploadService.reorderPhotos(req.user.id, photoIds);

    res.json({
      success: true,
      data: photos,
      message: 'Portfolio photos reordered successfully.',
    });
  })
);

export default router;
