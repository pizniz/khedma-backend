import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { providerService } from '../services/providerService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tier: z.enum(['basic', 'specialist']).optional(),
  category: z.string().optional(),
  city: z.string().optional(),
  search: z.string().optional(),
});

// GET /api/providers - list providers (public)
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

// GET /api/providers/:id - provider detail (public, phone hidden for specialists)
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

// PUT /api/providers/:id/tier - upgrade to specialist (requires auth + subscription)
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
