import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'khedma-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

export default router;
