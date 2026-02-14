import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { supabaseAdmin } from '../services/supabase';
import { config } from '../config';
import type { SocketData, RTCSessionDescriptionInit, RTCIceCandidateInit } from '../types';

/**
 * WebRTC signaling server via Socket.io.
 * Policy: Only allow calls where at least one party is a specialist.
 * Basic workers use direct phone (their number is public).
 */
export function setupSignalingServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.cors.origins,
      methods: ['GET', 'POST'],
    },
    path: '/signaling',
  });

  // Auth middleware for Socket.io
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        return next(new Error('Invalid token'));
      }

      // Check provider tier
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('provider_tier')
        .eq('user_id', user.id)
        .eq('user_type', 'provider')
        .single();

      (socket.data as SocketData) = {
        userId: user.id,
        tier: profile?.provider_tier ?? undefined,
      };

      next();
    } catch (err) {
      console.error('[Signaling] Auth error:', err);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const socketData = socket.data as SocketData;
    console.log(`[Signaling] Connected: ${socketData.userId}`);

    // Join room - format: call_{userId1}_{userId2}
    socket.on('join-room', async (roomId: string) => {
      try {
        const parts = roomId.split('_');
        if (parts.length !== 3 || parts[0] !== 'call') {
          socket.emit('error', { message: 'Invalid room format. Use: call_{userId1}_{userId2}' });
          return;
        }

        const [, userIdA, userIdB] = parts;

        if (socketData.userId !== userIdA && socketData.userId !== userIdB) {
          socket.emit('error', { message: 'Not authorized for this room' });
          return;
        }

        // At least one party must be a specialist
        const isCallerSpecialist = socketData.tier === 'specialist';

        if (!isCallerSpecialist) {
          const otherUserId = socketData.userId === userIdA ? userIdB : userIdA;
          const { data: otherProfile } = await supabaseAdmin
            .from('profiles')
            .select('provider_tier')
            .eq('user_id', otherUserId)
            .eq('user_type', 'provider')
            .single();

          if (!otherProfile || otherProfile.provider_tier !== 'specialist') {
            socket.emit('error', {
              message: 'In-app calling requires at least one specialist. Basic workers use direct phone.',
            });
            return;
          }
        }

        socket.join(roomId);
        socket.to(roomId).emit('user-joined', { userId: socketData.userId });
        console.log(`[Signaling] ${socketData.userId} joined ${roomId}`);
      } catch (err) {
        console.error('[Signaling] join-room error:', err);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // WebRTC offer
    socket.on('offer', (payload: { room: string; sdp: RTCSessionDescriptionInit }) => {
      socket.to(payload.room).emit('offer', { sdp: payload.sdp, from: socketData.userId });
    });

    // WebRTC answer
    socket.on('answer', (payload: { room: string; sdp: RTCSessionDescriptionInit }) => {
      socket.to(payload.room).emit('answer', { sdp: payload.sdp, from: socketData.userId });
    });

    // ICE candidate
    socket.on('ice-candidate', (payload: { room: string; candidate: RTCIceCandidateInit }) => {
      socket.to(payload.room).emit('ice-candidate', { candidate: payload.candidate, from: socketData.userId });
    });

    // End call
    socket.on('call-end', (payload: { room: string }) => {
      socket.to(payload.room).emit('call-ended', { from: socketData.userId });
      socket.leave(payload.room);
    });

    socket.on('disconnect', (reason: string) => {
      console.log(`[Signaling] Disconnected ${socketData.userId}: ${reason}`);
    });
  });

  return io;
}
