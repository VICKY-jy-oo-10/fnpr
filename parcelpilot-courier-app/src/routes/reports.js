'use strict';
const express = require('express');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);

router.get('/dashboard', (req, res) => {
  const user = req.user;
  const scope = user.role === 'CUSTOMER' ? ' AND customer_user_id=?' : user.role === 'COURIER' ? ' AND courier_user_id=?' : '';
  const args = scope ? [user.id] : [];
  const count = (condition = '') => db.prepare(`SELECT COUNT(*) AS n FROM shipments WHERE 1=1 ${scope} ${condition}`).get(...args).n;
  const summary = {
    totalShipments: count(),
    active: count("AND status NOT IN ('DELIVERED','RTO_DELIVERED','CANCELLED')"),
    outForDelivery: count("AND status='OUT_FOR_DELIVERY'"),
    delivered: count("AND status='DELIVERED'"),
    undelivered: count("AND status='UNDELIVERED'"),
    rto: count("AND status IN ('RTO_INITIATED','RTO_IN_TRANSIT','RTO_DELIVERED')"),
    bookedToday: count("AND date(created_at)=date('now')"),
    deliveredToday: count("AND date(delivered_at)=date('now')")
  };
  const statusWhere = user.role === 'CUSTOMER' ? 'WHERE customer_user_id=?' : user.role === 'COURIER' ? 'WHERE courier_user_id=?' : '';
  const statuses = db.prepare(`SELECT status,COUNT(*) AS count FROM shipments ${statusWhere} GROUP BY status ORDER BY count DESC`)
    .all(...(statusWhere ? [user.id] : []));
  const recent = db.prepare(`SELECT awb,receiver_name,receiver_city,status,created_at,amount FROM shipments
    WHERE 1=1 ${scope} ORDER BY created_at DESC LIMIT 6`).all(...args);
  const common = { summary, statuses, recent };
  if (user.role !== 'ADMIN') return res.json(common);

  const activeCouriers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='COURIER' AND active=1").get().n;
  const liveDeliveries = db.prepare("SELECT COUNT(DISTINCT shipment_id) AS n FROM courier_locations WHERE is_active=1").get().n;
  const deliveryRate = db.prepare(`SELECT ROUND(100.0*SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1) AS rate FROM shipments WHERE date(created_at)>=date('now','-30 day')`).get().rate || 0;
  const daily = db.prepare(`SELECT date(created_at) AS day,COUNT(*) AS bookings,
    SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered FROM shipments
    WHERE date(created_at)>=date('now','-6 day') GROUP BY date(created_at) ORDER BY day`).all();
  const courierPerformance = db.prepare(`SELECT u.name AS courier,
    COUNT(s.id) AS assigned, SUM(CASE WHEN s.status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN s.status='UNDELIVERED' THEN 1 ELSE 0 END) AS undelivered
    FROM users u LEFT JOIN shipments s ON s.courier_user_id=u.id WHERE u.role='COURIER' GROUP BY u.id ORDER BY delivered DESC`).all();
  const finance = db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='INCOME' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN kind='EXPENSE' THEN amount ELSE 0 END),0) AS expenses FROM financial_entries WHERE date(entry_date)>=date('now','-29 day')`).get();
  return res.json({ ...common, admin: { activeCouriers, liveDeliveries, deliveryRate, daily, courierPerformance, finance: { ...finance, net: finance.income - finance.expenses } } });
});

router.get('/', requireRole('ADMIN'), (req, res) => {
  const defaultFrom = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = String(req.query.from || defaultFrom);
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const summary = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN status='UNDELIVERED' THEN 1 ELSE 0 END) AS undelivered,
    SUM(CASE WHEN status IN ('RTO_INITIATED','RTO_IN_TRANSIT','RTO_DELIVERED') THEN 1 ELSE 0 END) AS rto,
    AVG(CASE WHEN delivered_at IS NOT NULL THEN (julianday(delivered_at)-julianday(created_at))*24 END) AS avgHours
    FROM shipments WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)`).get(from, to);
  const statuses = db.prepare('SELECT status,COUNT(*) AS count FROM shipments GROUP BY status ORDER BY count DESC').all();
  const trends = db.prepare(`SELECT date(created_at) AS day,COUNT(*) AS bookings,
    SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered FROM shipments
    WHERE date(created_at)>=date(?) AND date(created_at)<=date(?) GROUP BY date(created_at) ORDER BY day`).all(from, to);
  const r = db.prepare(`SELECT COUNT(*) AS allCount,
    SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN status IN ('RTO_INITIATED','RTO_IN_TRANSIT','RTO_DELIVERED') THEN 1 ELSE 0 END) AS rto
    FROM shipments WHERE date(created_at)>=date(?) AND date(created_at)<=date(?)`).get(from, to);
  return res.json({ summary: { ...summary, deliverySuccessRate: r.allCount ? Math.round(100 * (r.delivered || 0) / r.allCount) : 0, rtoRate: r.allCount ? Math.round(100 * (r.rto || 0) / r.allCount) : 0 }, statuses, trends });
});

router.get('/export.csv', requireRole('ADMIN'), (_req, res) => {
  const rows = db.prepare(`SELECT s.awb,s.status,s.sender_name,s.sender_city,s.receiver_name,s.receiver_phone,s.receiver_city,
    s.service_type,s.weight_kg,s.amount,s.created_at,s.delivered_at,u.name AS courier_name
    FROM shipments s LEFT JOIN users u ON u.id=s.courier_user_id ORDER BY s.created_at DESC LIMIT 5000`).all();
  const fields = ['awb','status','sender_name','sender_city','receiver_name','receiver_phone','receiver_city','service_type','weight_kg','amount','created_at','delivered_at','courier_name'];
  const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [fields.join(','), ...rows.map((row) => fields.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="parcelpilot-shipments.csv"');
  res.send(csv);
});
module.exports = router;
