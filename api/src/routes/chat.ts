import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { writeLimiter } from '../middleware/rateLimiter';
import { chatService } from '../services/chatService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// ─── Validation Schemas ─────────────────────────────────────

const createConversationSchema = z.object({
  provider_id: z.string().uuid('Invalid provider ID'),
  booking_id: z.string().uuid('Invalid booking ID').optional(),
});

const messagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters'),
});

// ─── GET /api/conversations - List user's conversations ─────

router.get(
  '/',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const conversations = await chatService.listConversations(req.user.id);

    res.json({
      success: true,
      data: conversations,
    });
  })
);

// ─── POST /api/conversations - Create a conversation ────────

router.post(
  '/',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = createConversationSchema.parse(req.body);

    const conversation = await chatService.getOrCreateConversation(
      req.user.id,
      body.provider_id,
      body.booking_id
    );

    res.status(201).json({
      success: true,
      data: conversation,
      message: 'Conversation created successfully.',
    });
  })
);

// ─── GET /api/conversations/:id/messages - Get messages ─────

router.get(
  '/:id/messages',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: conversationId } = req.params;
    const query = messagesQuerySchema.parse(req.query);

    const { messages, total } = await chatService.getMessages(
      conversationId,
      req.user.id,
      query.page,
      query.limit
    );

    const totalPages = Math.ceil(total / query.limit);

    res.json({
      success: true,
      data: messages,
      pagination: { page: query.page, limit: query.limit, total, totalPages },
    });
  })
);

// ─── POST /api/conversations/:id/messages - Send message ────

router.post(
  '/:id/messages',
  authMiddleware as any,
  writeLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: conversationId } = req.params;
    const body = sendMessageSchema.parse(req.body);

    const message = await chatService.sendMessage(
      conversationId,
      req.user.id,
      body.content
    );

    res.status(201).json({
      success: true,
      data: message,
      message: 'Message sent successfully.',
    });
  })
);

// ─── PATCH /api/conversations/:id/read - Mark as read ───────

router.patch(
  '/:id/read',
  authMiddleware as any,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id: conversationId } = req.params;

    const count = await chatService.markAsRead(conversationId, req.user.id);

    res.json({
      success: true,
      message: `${count} message(s) marked as read.`,
    });
  })
);

export default router;
