import http from 'http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { apiLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import routes from './routes';
import { setupSignalingServer } from './signaling/webrtc';

const app = express();
const server = http.createServer(app);

// Security
app.use(helmet());
app.use(
  cors({
    origin: config.cors.origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use('/api', apiLimiter);

// Routes
app.use('/api', routes);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// WebRTC Signaling
const io = setupSignalingServer(server);

// Start server
server.listen(config.port, () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║   Khedma API Server                           ║
  ║   Port:        ${String(config.port).padEnd(30)}║
  ║   Environment: ${config.nodeEnv.padEnd(30)}║
  ║   Signaling:   /signaling                     ║
  ╚═══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down...`);
  io.close(() => console.log('[Shutdown] Socket.io closed'));
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server, io };
