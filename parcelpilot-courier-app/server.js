'use strict';
require('dotenv').config();
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const { db } = require('./src/db');
const { COOKIE_NAME, resolveUser } = require('./src/middleware/auth');
const { normalizeRole } = require('./src/status');
const authRoutes = require('./src/routes/auth');
const { router: shipmentRoutes, hasShipmentAccess } = require('./src/routes/shipments');
const operationsRoutes = require('./src/routes/operations');
const financeRoutes = require('./src/routes/finance');
const reportsRoutes = require('./src/routes/reports');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, transports: ['websocket', 'polling'] });
app.set('io', io);
app.set('simulations', new Map());

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://server.arcgisonline.com'],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://server.arcgisonline.com'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again in a few minutes.' } });
app.use('/api/auth', authLimiter);
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'ParcelPilot API', time: new Date().toISOString(), demoMode: process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true' }));

app.use('/api/auth', authRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api', operationsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*path', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error('Unhandled request error:', err?.stack || err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please retry.' });
});

function parseCookie(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}
io.use((socket, next) => {
  const cookies = parseCookie(socket.request.headers.cookie || '');
  const token = cookies[COOKIE_NAME] || socket.handshake.auth?.token;
  const user = resolveUser(token);
  if (!user) return next(new Error('Unauthorized socket connection'));
  socket.data.user = user;
  next();
});
io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  if (user.role === 'ADMIN') socket.join('role:ADMIN');
  socket.on('join-shipment', (shipmentId, callback = () => {}) => {
    if (typeof shipmentId !== 'string' || shipmentId.length > 100) return callback({ ok: false, error: 'Invalid shipment.' });
    const shipment = db.prepare('SELECT id,customer_user_id,courier_user_id FROM shipments WHERE id=?').get(shipmentId);
    if (!shipment || !hasShipmentAccess(user, shipment)) return callback({ ok: false, error: 'Shipment access denied.' });
    socket.join(`shipment:${shipmentId}`);
    callback({ ok: true });
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  const demo = process.env.DEMO_MODE === 'true';
  console.log(`ParcelPilot running at http://localhost:${port}`);
  console.log(`Demo mode: ${demo ? 'enabled' : 'disabled'}`);
  if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET || '').length < 32) {
    console.error('FATAL CONFIG: JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
});

function shutdown() {
  const simulations = app.get('simulations') || new Map();
  for (const timer of simulations.values()) clearInterval(timer);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
