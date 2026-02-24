import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../services/supabase';
import type { AuthenticatedRequest } from '../types';

/**
 * Role-based access control middleware.
 * Checks that the authenticated user has the required user_type in profiles.
 */
export function requireRole(...allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('user_type')
      .eq('user_id', req.user.id)
      .single();

    if (!profile || !allowedRoles.includes(profile.user_type)) {
      res.status(403).json({
        success: false,
        error: `This action requires one of: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}
