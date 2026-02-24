import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { verificationService } from '../services/verificationService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP'));
    }
  },
});

// ─── POST /api/verification/submit ─── Submit CIN + selfie
router.post(
  '/submit',
  authMiddleware as any,
  writeLimiter,
  upload.fields([
    { name: 'cin_photo', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files?.cin_photo?.[0] || !files?.selfie?.[0]) {
      res.status(400).json({ success: false, error: 'Both CIN photo and selfie are required' });
      return;
    }

    const verification = await verificationService.submitVerification(
      req.user.id,
      files.cin_photo[0],
      files.selfie[0]
    );

    res.status(201).json({
      success: true,
      data: verification,
      message: 'Verification submitted. You will be notified once reviewed.',
    });
  })
);

// ─── GET /api/verification/status ─── Get own verification status
router.get(
  '/status',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const status = await verificationService.getStatus(req.user.id);
    res.json({ success: true, data: status });
  })
);

// ─── GET /api/verification/pending ─── Admin: list pending verifications
router.get(
  '/pending',
  authMiddleware as any,
  requireRole('admin') as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const result = await verificationService.listPending(page, limit);
    res.json({ success: true, ...result });
  })
);

// ─── POST /api/verification/:id/review ─── Admin: approve/reject
const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  rejection_reason: z.string().max(500).optional(),
});

router.post(
  '/:id/review',
  authMiddleware as any,
  requireRole('admin') as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = reviewSchema.parse(req.body);
    const verification = await verificationService.review(
      req.params.id,
      req.user.id,
      body.decision,
      body.rejection_reason
    );

    res.json({
      success: true,
      data: verification,
      message: `Verification ${body.decision}.`,
    });
  })
);

export default router;
