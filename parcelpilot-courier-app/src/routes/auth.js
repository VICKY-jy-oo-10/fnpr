'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { db } = require('../db');
const { issueSession, clearSession, authenticate, optionalAuthenticate } = require('../middleware/auth');
const { normalizeRole } = require('../status');
const { audit } = require('../services/audit');

const router = express.Router();
const otpChallenges = new Map();

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email || null, phone: user.phone || null, role: normalizeRole(user.role) };
}
function phoneDigits(value) { return String(value || '').replace(/[^0-9]/g, ''); }

router.post('/customer/request-otp', (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true' || !process.env.DEMO_OTP) {
    return res.status(503).json({ error: 'SMS verification is not configured. Ask the administrator to enable an OTP provider.' });
  }
  const phone = String(req.body.phone || '').trim();
  const digits = phoneDigits(phone);
  if (digits.length < 10 || digits.length > 15) return res.status(400).json({ error: 'Enter a valid mobile number with country code.' });
  const normalizedPhone = phone.startsWith('+') ? `+${digits}` : `+${digits}`;
  const otp = process.env.DEMO_OTP;
  otpChallenges.set(normalizedPhone, { otp, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
  const response = { message: 'Development OTP generated. It expires in 5 minutes.' };
  if (process.env.NODE_ENV !== 'production') response.demoCode = otp;
  return res.json(response);
});

router.post('/customer/verify-otp', (req, res) => {
  const rawPhone = String(req.body.phone || '').trim();
  const phone = `+${phoneDigits(rawPhone)}`;
  const code = String(req.body.otp || '').trim();
  const challenge = otpChallenges.get(phone);
  if (!challenge || Date.now() > challenge.expiresAt) {
    otpChallenges.delete(phone);
    return res.status(400).json({ error: 'OTP expired. Request a new code.' });
  }
  if (challenge.attempts >= 5) {
    otpChallenges.delete(phone);
    return res.status(429).json({ error: 'Too many incorrect attempts. Request a new OTP.' });
  }
  if (code !== challenge.otp) {
    challenge.attempts += 1;
    return res.status(400).json({ error: 'The OTP is incorrect.' });
  }
  otpChallenges.delete(phone);
  let user = db.prepare("SELECT * FROM users WHERE phone=? AND role='CUSTOMER'").get(phone);
  if (!user) {
    const id = crypto.randomUUID();
    const name = String(req.body.name || 'New customer').trim().slice(0, 100);
    db.prepare("INSERT INTO users (id,name,phone,role,active) VALUES (?, ?, ?, 'CUSTOMER', 1)").run(id, name, phone);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    db.prepare(`INSERT INTO customers (id,user_id,name,phone) VALUES (?, ?, ?, ?)`)
      .run(crypto.randomUUID(), id, name, phone);
  } else if (!user.active) {
    return res.status(403).json({ error: 'This customer account is inactive. Contact support.' });
  }
  issueSession(res, user);
  audit({ actor: user, action: 'LOGIN', entityType: 'user', entityId: user.id });
  return res.json({ user: publicUser(user) });
});

router.post('/staff/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const requestedRole = normalizeRole(req.body.role);
  if (!['ADMIN', 'COURIER'].includes(requestedRole)) return res.status(400).json({ error: 'Choose Admin/Staff or Delivery Executive to continue.' });
  if (!email || !password) return res.status(400).json({ error: 'Work email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(email);
  const passwordOK = user?.password_hash ? bcrypt.compareSync(password, user.password_hash) : false;
  if (!user || !passwordOK || !user.active) return res.status(401).json({ error: 'Invalid work email or password.' });
  const actualRole = normalizeRole(user.role);
  if (actualRole !== requestedRole) {
    const message = requestedRole === 'ADMIN'
      ? 'Unauthorized access. This account does not have administrator privileges.'
      : 'Unauthorized access. This account does not have delivery executive privileges.';
    return res.status(403).json({ error: message, code: 'WRONG_ROLE' });
  }
  issueSession(res, user);
  audit({ actor: user, action: 'LOGIN', entityType: 'user', entityId: user.id });
  return res.json({ user: publicUser(user) });
});

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));
router.post('/logout', optionalAuthenticate, (req, res) => {
  const user = req.user;
  if (user) {
    audit({ actor: user, action: 'LOGOUT', entityType: 'user', entityId: user.id });
    if (user.role === 'COURIER') {
      db.prepare('UPDATE courier_locations SET is_active=0 WHERE courier_user_id=?').run(user.id);
      const simulations = req.app.get('simulations') || new Map();
      for (const [shipmentId, timer] of simulations.entries()) {
        const shipment = db.prepare('SELECT courier_user_id FROM shipments WHERE id=?').get(shipmentId);
        if (shipment?.courier_user_id === user.id) { clearInterval(timer); simulations.delete(shipmentId); }
      }
      req.app.set('simulations', simulations);
    }
    req.app.get('io')?.in(`user:${user.id}`).disconnectSockets(true);
  }
  clearSession(res);
  return res.json({ ok: true });
});

module.exports = router;
