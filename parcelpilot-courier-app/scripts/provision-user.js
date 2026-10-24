'use strict';
require('dotenv').config();
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function fail(message) { console.error(message); process.exit(1); }

const role = String(arg('role') || '').toUpperCase();
const name = String(arg('name') || '').trim();
const email = String(arg('email') || '').trim().toLowerCase();
const phone = String(arg('phone') || '').trim();
const password = String(arg('password') || '');
if (!['ADMIN', 'COURIER'].includes(role)) fail('Usage: node scripts/provision-user.js --role ADMIN|COURIER --name "Full Name" --email user@company.com --phone +91... --password "strong-password"');
if (!name || !email || !email.includes('@') || !phone || phone.replace(/\D/g, '').length < 10) fail('Name, valid work email and phone are required.');
if (password.length < 12) fail('Password must be at least 12 characters long.');
if (process.env.NODE_ENV !== 'production' && !process.env.DB_PATH) console.warn('Using the configured default local database path.');
if (db.prepare('SELECT 1 FROM users WHERE email=? OR phone=?').get(email, phone)) fail('A user with this email or phone already exists.');
const id = crypto.randomUUID();
db.prepare('INSERT INTO users (id,name,email,phone,password_hash,role,active) VALUES (?,?,?,?,?,?,1)')
  .run(id, name, email, phone, bcrypt.hashSync(password, 12), role);
console.log(`Created ${role} account: ${email} (${id})`);
db.close();
