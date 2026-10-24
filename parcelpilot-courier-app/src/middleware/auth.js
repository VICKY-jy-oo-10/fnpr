'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { normalizeRole } = require('../status');

const COOKIE_NAME = 'pp_session';
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-only-change-this-secret-before-deployment';

function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h', issuer: 'parcelpilot' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: String(process.env.COOKIE_SECURE || 'false') === 'true',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: String(process.env.COOKIE_SECURE || 'false') === 'true', sameSite: 'lax', path: '/' });
}

function tokenFromRequest(req) {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return cookieToken || bearer || null;
}

function resolveUser(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'parcelpilot' });
    const row = db.prepare('SELECT id, name, email, phone, role, active FROM users WHERE id = ?').get(payload.sub);
    if (!row || !row.active) return null;
    const role = normalizeRole(row.role);
    if (!role) return null;
    return { ...row, role };
  } catch {
    return null;
  }
}

function authenticate(req, res, next) {
  const token = tokenFromRequest(req);
  const user = resolveUser(token);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.', code: 'UNAUTHENTICATED' });
  req.user = user;
  next();
}

function optionalAuthenticate(req, _res, next) {
  req.user = resolveUser(tokenFromRequest(req));
  next();
}

function requireRole(...roles) {
  const allowed = roles.map(normalizeRole).filter(Boolean);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.', code: 'UNAUTHENTICATED' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Unauthorized access. This account does not have permission for this action.', code: 'FORBIDDEN' });
    }
    next();
  };
}

module.exports = { COOKIE_NAME, JWT_SECRET, issueSession, clearSession, tokenFromRequest, resolveUser, authenticate, optionalAuthenticate, requireRole };
