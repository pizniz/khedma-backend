import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { providerService } from '../services/providerService';
import { uploadService } from '../services/uploadService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// ─── Validation Schemas ─────────────────────────────────────

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tier: z.enum(['basic', 'specialist']).optional(),
  category: z.string().optional(),
  city: z.string().optional(),
  search: z.string().optional(),
});

const createProviderSchema = z.object({
  full_name: z.string().min(1).max(100),
  categories: z.array(z.string()).min(1),
  city: z.string().min(1).max(100),
  tier: z.enum(['basic', 'specialist']),
  bio: z.string().max(1000).optional(),
});

const updateProfileSchema = z.object({
  full_name: z.string().min(1).max(100).optional(),
  bio: z.string().max(1000).optional(),
  city: z.string().max(100).optional(),
  avatar_url: z.string().url().optional(),
  is_available: z.boolean().optional(),
});

// ─── GET /api/providers/me - Get own provider profile ───────
// IMPORTANT: /me routes must be registered BEFORE /:id to avoid
// Express matching "me" as an id parameter.

router.get(
  '/me',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const provider = await providerService.getOwnProfile(req.user.id);

    if (!provider) {
      res.status(404).json({ success: false, error: 'Provider profile not found' });
      return;
    }

    res.json({ success: true, data: provider });
  })
);

// ─── PUT /api/providers/me - Update own provider profile ────

router.put(
  '/me',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = updateProfileSchema.parse(req.body);

    const updated = await providerService.updateProfile(req.user.id, body);

    res.json({
      success: true,
      data: updated,
      message: 'Profile updated successfully.',
    });
  })
);

// ─── POST /api/providers - Register as provider ─────────────

router.post(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = createProviderSchema.parse(req.body);

    const provider = await providerService.createProvider(req.user.id, req.user.phone || '', body);

    res.status(201).json({
      success: true,
      data: provider,
      message: 'Provider profile created successfully.',
    });
  })
);

// ─── GET /api/providers - List providers (public) ───────────

router.get(
  '/',
  asyncHandler(async (req, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const { providers, total } = await providerService.listProviders(query);
    const totalPages = Math.ceil(total / query.limit);

    res.json({
      success: true,
      data: providers,
      pagination: { page: query.page, limit: query.limit, total, totalPages },
    });
  })
);

// ─── GET /api/providers/:id - Provider detail (public, phone hidden for specialists) ─

router.get(
  '/:id',
  asyncHandler(async (req, res: Response) => {
    const { id } = req.params;

    // Try to get requester ID for "own profile" check
    let requesterId: string | undefined;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const { createUserClient } = await import('../services/supabase');
        const client = createUserClient(authHeader.substring(7));
        const { data } = await client.auth.getUser();
        requesterId = data.user?.id;
      }
    } catch {
      // Public endpoint - ignore auth errors
    }

    const provider = await providerService.getProviderById(id, requesterId);

    if (!provider) {
      res.status(404).json({ success: false, error: 'Provider not found' });
      return;
    }

    res.json({ success: true, data: provider });
  })
);

// ─── GET /api/providers/:id/photos - List portfolio photos (public) ──

router.get(
  '/:id/photos',
  asyncHandler(async (req, res: Response) => {
    const { id } = req.params;
    const photos = await uploadService.listPortfolioPhotos(id);

    res.json({ success: true, data: photos });
  })
);

// ─── PUT /api/providers/:id/tier - Upgrade to specialist (requires auth + subscription) ─

router.put(
  '/:id/tier',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updated = await providerService.upgradeTier(id, req.user.id);

    res.json({
      success: true,
      data: updated,
      message: 'Provider upgraded to specialist tier.',
    });
  })
);

export default router;
