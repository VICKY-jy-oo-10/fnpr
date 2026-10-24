'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit, queueSync } = require('../services/audit');
const router = express.Router();
router.use(authenticate, requireRole('ADMIN'));

router.get('/', (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const where = [];
  const params = {};
  if (from) { where.push('entry_date >= @from'); params.from = from; }
  if (to) { where.push('entry_date <= @to'); params.to = to; }
  const entriesQuery = db.prepare(`SELECT f.*,u.name AS created_by_name FROM financial_entries f JOIN users u ON u.id=f.created_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY entry_date DESC,created_at DESC LIMIT 500`);
  const totalsQuery = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind='INCOME' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN kind='EXPENSE' THEN amount ELSE 0 END),0) AS expenses,
    COUNT(*) AS entries FROM financial_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`);
  const entries = where.length ? entriesQuery.all(params) : entriesQuery.all();
  const totals = where.length ? totalsQuery.get(params) : totalsQuery.get();
  return res.json({ entries, totals: { ...totals, net: totals.income - totals.expenses } });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '').toUpperCase();
  const category = String(b.category || '').trim();
  const amount = Number(b.amount);
  if (!['INCOME', 'EXPENSE'].includes(kind)) return res.status(400).json({ error: 'Select income or expense.' });
  if (!category || category.length > 80) return res.status(400).json({ error: 'Enter a valid category.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Amount must be greater than 0 and within the supported limit.' });
  const id = crypto.randomUUID();
  const entryDate = String(b.entryDate || new Date().toISOString().slice(0, 10));
  db.prepare(`INSERT INTO financial_entries (id,kind,category,amount,reference,description,entry_date,created_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, kind, category, amount, String(b.reference || '').slice(0, 100), String(b.description || '').slice(0, 500), entryDate, req.user.id);
  audit({ actor: req.user, action: 'FINANCIAL_ENTRY_CREATED', entityType: 'financial_entry', entityId: id, newValue: { kind, category, amount } });
  queueSync('financial_entry', id, 'CREATE');
  return res.status(201).json({ entry: db.prepare('SELECT * FROM financial_entries WHERE id=?').get(id) });
});

router.delete('/:id', (req, res) => {
  const entry = db.prepare('SELECT * FROM financial_entries WHERE id=?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Financial entry not found.' });
  db.prepare('DELETE FROM financial_entries WHERE id=?').run(entry.id);
  audit({ actor: req.user, action: 'FINANCIAL_ENTRY_DELETED', entityType: 'financial_entry', entityId: entry.id, oldValue: { kind: entry.kind, amount: entry.amount } });
  return res.json({ ok: true });
});
module.exports = router;
