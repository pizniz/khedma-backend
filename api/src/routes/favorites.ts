import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { favoritesService } from '../services/favoritesService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// All favorites routes require authentication
router.use(authMiddleware as any);

const addFavoriteSchema = z.object({
  provider_id: z.string().uuid('Invalid provider ID'),
});

// POST /api/favorites — Add a favorite
router.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = addFavoriteSchema.parse(req.body);
    const result = await favoritesService.addFavorite(req.user.id, body.provider_id);

    res.status(201).json({
      success: true,
      data: result,
      message: 'Favorite added.',
    });
  })
);

// DELETE /api/favorites/:providerId — Remove a favorite
router.delete(
  '/:providerId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { providerId } = req.params;
    await favoritesService.removeFavorite(req.user.id, providerId);

    res.json({
      success: true,
      message: 'Favorite removed.',
    });
  })
);

// GET /api/favorites — List all favorites (returns provider data)
router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const favorites = await favoritesService.listFavorites(req.user.id);

    res.json({
      success: true,
      data: favorites,
    });
  })
);

// GET /api/favorites/check?ids=id1,id2,id3 — Batch check favorite status
router.get(
  '/check',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const idsParam = req.query.ids as string;
    if (!idsParam) {
      res.json({ success: true, data: {} });
      return;
    }

    const ids = idsParam.split(',').filter(Boolean);
    const status = await favoritesService.getFavoriteStatus(req.user.id, ids);

    res.json({
      success: true,
      data: status,
    });
  })
);

export default router;
