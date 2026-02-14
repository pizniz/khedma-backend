import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../services/supabase';
import type { AuthenticatedRequest } from '../types';

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      email: user.email,
      user_metadata: user.user_metadata,
    };

    next();
  } catch {
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
}
