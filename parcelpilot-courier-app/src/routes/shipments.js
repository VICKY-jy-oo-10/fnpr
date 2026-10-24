'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeRole, SHIPMENT_STATUS, canTransition } = require('../status');
const { generateAwb } = require('../services/awb');
const { audit, notify, queueSync } = require('../services/audit');
const { shipmentById, eventStatus } = require('../services/shipments');

const router = express.Router();
router.use(authenticate);

function hasShipmentAccess(user, shipment) {
  if (!shipment) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'CUSTOMER') return shipment.customer_user_id === user.id;
  if (user.role === 'COURIER') return shipment.courier_user_id === user.id;
  return false;
}

function validateBooking(body) {
  const required = [
    'senderName', 'senderPhone', 'senderAddress', 'senderCity', 'senderPincode',
    'receiverName', 'receiverPhone', 'receiverAddress', 'receiverCity', 'receiverPincode'
  ];
  const missing = required.filter((key) => !String(body[key] ?? '').trim());
  if (missing.length) return `Please complete: ${missing.map((x) => x.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`)).join(', ')}.`;
  const weight = Number(body.weightKg ?? 1);
  const amount = Number(body.amount ?? 0);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) return 'Weight must be greater than 0 and no more than 1,000 kg.';
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return 'Enter a valid shipment amount.';
  for (const key of ['senderPhone', 'receiverPhone']) {
    if (String(body[key]).replace(/\D/g, '').length < 10) return `Enter a valid ${key === 'senderPhone' ? 'sender' : 'receiver'} phone number.`;
  }
  return null;
}

router.get('/', (req, res) => {
  const { search = '', status = '', courierId = '', from = '', to = '', limit = '100', offset = '0' } = req.query;
  const where = [];
  const params = {};
  if (req.user.role === 'CUSTOMER') { where.push('s.customer_user_id=@userId'); params.userId = req.user.id; }
  if (req.user.role === 'COURIER') { where.push('s.courier_user_id=@userId'); params.userId = req.user.id; }
  if (status && Object.hasOwn(SHIPMENT_STATUS, String(status).toUpperCase())) { where.push('s.status=@status'); params.status = String(status).toUpperCase(); }
  if (req.user.role === 'ADMIN' && courierId) { where.push('s.courier_user_id=@courierId'); params.courierId = courierId; }
  if (from) { where.push('date(s.created_at)>=date(@from)'); params.from = String(from); }
  if (to) { where.push('date(s.created_at)<=date(@to)'); params.to = String(to); }
  const query = String(search).trim();
  if (query) {
    where.push('(s.awb LIKE @query OR s.receiver_name LIKE @query OR s.receiver_phone LIKE @query OR s.sender_name LIKE @query)');
    params.query = `%${query.slice(0, 80)}%`;
  }
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 100));
  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  params.limit = safeLimit; params.offset = safeOffset;
  const sql = `SELECT s.*, cu.name AS courier_name, cu.phone AS courier_phone FROM shipments s
    LEFT JOIN users cu ON cu.id=s.courier_user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.created_at DESC LIMIT @limit OFFSET @offset`;
  return res.json({ shipments: db.prepare(sql).all(params), limit: safeLimit, offset: safeOffset });
});

router.post('/', requireRole('ADMIN'), (req, res) => {
  const error = validateBooking(req.body || {});
  if (error) return res.status(400).json({ error });
  const b = req.body;
  const id = crypto.randomUUID();
  let awb = generateAwb();
  while (db.prepare('SELECT 1 FROM shipments WHERE awb=?').get(awb)) awb = generateAwb();
  const linkedCustomer = db.prepare("SELECT id FROM users WHERE phone=? AND role='CUSTOMER'").get(`+${String(b.customerPhone || b.receiverPhone).replace(/\D/g, '')}`);
  const customerId = linkedCustomer?.id || null;
  const insert = db.prepare(`INSERT INTO shipments (
    id, awb, customer_user_id, created_by, sender_name, sender_phone, sender_address, sender_city, sender_pincode,
    receiver_name, receiver_phone, receiver_address, receiver_city, receiver_pincode, package_type, weight_kg, dimensions,
    service_type, payment_mode, amount, special_instructions, status, origin_hub, destination_hub
  ) VALUES (@id,@awb,@customerId,@createdBy,@senderName,@senderPhone,@senderAddress,@senderCity,@senderPincode,
    @receiverName,@receiverPhone,@receiverAddress,@receiverCity,@receiverPincode,@packageType,@weightKg,@dimensions,
    @serviceType,@paymentMode,@amount,@specialInstructions,'BOOKED',@originHub,@destinationHub)`);
  try {
    const tx = db.transaction(() => {
      insert.run({
        id, awb, customerId, createdBy: req.user.id,
        senderName: String(b.senderName).trim(), senderPhone: String(b.senderPhone).trim(), senderAddress: String(b.senderAddress).trim(), senderCity: String(b.senderCity).trim(), senderPincode: String(b.senderPincode).trim(),
        receiverName: String(b.receiverName).trim(), receiverPhone: String(b.receiverPhone).trim(), receiverAddress: String(b.receiverAddress).trim(), receiverCity: String(b.receiverCity).trim(), receiverPincode: String(b.receiverPincode).trim(),
        packageType: String(b.packageType || 'Parcel').slice(0, 50), weightKg: Number(b.weightKg || 1), dimensions: String(b.dimensions || '').slice(0, 100),
        serviceType: String(b.serviceType || 'Standard').slice(0, 30), paymentMode: String(b.paymentMode || 'Prepaid').slice(0, 30), amount: Number(b.amount || 0),
        specialInstructions: String(b.specialInstructions || '').slice(0, 500), originHub: String(b.originHub || '').slice(0, 100), destinationHub: String(b.destinationHub || '').slice(0, 100)
      });
      db.prepare(`INSERT INTO tracking_events (shipment_id,status,location,remarks,actor_user_id) VALUES (?,'BOOKED',?,'Shipment booked',?)`)
        .run(id, String(b.originHub || ''), req.user.id);
      audit({ actor: req.user, action: 'SHIPMENT_CREATED', entityType: 'shipment', entityId: id, newValue: { awb, status: 'BOOKED' } });
      queueSync('shipment', id, 'CREATE');
      if (customerId) notify(customerId, 'Shipment booked', `Your shipment ${awb} has been booked.`, 'SHIPMENT');
    });
    tx();
    const created = shipmentById(id);
    req.app.get('io')?.to('role:ADMIN').emit('shipment:updated', { shipmentId: id, awb, status: created.status });
    if (customerId) req.app.get('io')?.to(`shipment:${id}`).emit('shipment:updated', { shipmentId: id, awb, status: created.status });
    return res.status(201).json({ shipment: created });
  } catch (e) {
    console.error('Shipment creation failed:', e.message);
    return res.status(500).json({ error: 'Unable to create shipment. Please try again.' });
  }
});

router.get('/track/:awb', (req, res) => {
  const awb = String(req.params.awb || '').trim().toUpperCase();
  const shipment = db.prepare(`SELECT s.*, cu.name AS courier_name, cu.phone AS courier_phone
    FROM shipments s LEFT JOIN users cu ON cu.id=s.courier_user_id WHERE s.awb=?`).get(awb);
  if (!shipment) return res.status(404).json({ error: 'No shipment found for that AWB.' });
  if (!hasShipmentAccess(req.user, shipment)) return res.status(403).json({ error: 'This shipment is not linked to your account.' });
  const events = db.prepare('SELECT status, location, remarks, created_at FROM tracking_events WHERE shipment_id=? ORDER BY created_at ASC, id ASC').all(shipment.id);
  const pod = ['ADMIN', 'CUSTOMER'].includes(req.user.role) && (req.user.role === 'ADMIN' || shipment.customer_user_id === req.user.id)
    ? db.prepare('SELECT id, receiver_name, remarks, delivered_at, photo_filename FROM pod_records WHERE shipment_id=?').get(shipment.id) : null;
  const location = shipment.status === 'OUT_FOR_DELIVERY' ? db.prepare(`SELECT latitude,longitude,accuracy_m,updated_at,source FROM courier_locations WHERE shipment_id=? AND is_active=1 ORDER BY updated_at DESC LIMIT 1`).get(shipment.id) : null;
  const safePod = pod ? { id: pod.id, receiver_name: pod.receiver_name, remarks: pod.remarks, delivered_at: pod.delivered_at, photoAvailable: Boolean(pod.photo_filename), photoUrl: pod.photo_filename ? `/api/pod/${pod.id}/photo` : null } : null;
  return res.json({ shipment: { ...shipment, courier_user_id: undefined, created_by: undefined }, events, pod: safePod, location: location || null });
});

router.get('/:id/events', (req, res) => {
  const shipment = shipmentById(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (!hasShipmentAccess(req.user, shipment)) return res.status(403).json({ error: 'You cannot access this shipment.' });
  return res.json({ events: db.prepare('SELECT * FROM tracking_events WHERE shipment_id=? ORDER BY created_at ASC, id ASC').all(shipment.id) });
});

router.post('/:id/assign', requireRole('ADMIN'), (req, res) => {
  const shipment = shipmentById(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  const courierId = String(req.body.courierId || '');
  const courier = db.prepare("SELECT id,name FROM users WHERE id=? AND role='COURIER' AND active=1").get(courierId);
  if (!courier) return res.status(400).json({ error: 'Choose an active delivery executive.' });
  db.prepare('UPDATE shipments SET courier_user_id=?, updated_at=datetime(\'now\') WHERE id=?').run(courier.id, shipment.id);
  if (shipment.status === 'BOOKED') {
    const updated = shipmentById(shipment.id);
    eventStatus({ shipment: updated, nextStatus: 'PICKUP_ASSIGNED', actor: req.user, remarks: `Assigned to ${courier.name}` });
  }
  audit({ actor: req.user, action: 'COURIER_ASSIGNED', entityType: 'shipment', entityId: shipment.id, oldValue: { courierId: shipment.courier_user_id }, newValue: { courierId: courier.id } });
  notify(courier.id, 'New shipment assigned', `${shipment.awb} has been assigned to you.`, 'ASSIGNMENT');
  const updated = shipmentById(shipment.id);
  req.app.get('io')?.to('role:ADMIN').emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
  if (updated.customer_user_id) req.app.get('io')?.to(`shipment:${updated.id}`).emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
  req.app.get('io')?.to(`user:${courier.id}`).emit('assignment:updated', { shipmentId: updated.id, awb: updated.awb });
  return res.json({ shipment: updated });
});

router.post('/:id/status', (req, res) => {
  const shipment = shipmentById(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (!hasShipmentAccess(req.user, shipment)) return res.status(403).json({ error: 'You cannot update this shipment.' });
  if (req.user.role === 'CUSTOMER') return res.status(403).json({ error: 'Customers can view tracking but cannot change shipment status.' });
  const nextStatus = String(req.body.status || '').toUpperCase();
  if (!Object.hasOwn(SHIPMENT_STATUS, nextStatus)) return res.status(400).json({ error: 'Select a valid shipment status.' });
  try {
    const updated = eventStatus({ shipment, nextStatus, actor: req.user, remarks: String(req.body.remarks || '').slice(0, 500), location: String(req.body.location || '').slice(0, 120) });
    req.app.get('io')?.to('role:ADMIN').emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
    if (updated.customer_user_id) req.app.get('io')?.to(`shipment:${updated.id}`).emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
    return res.json({ shipment: updated });
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message, code: e.code || 'STATUS_UPDATE_FAILED' });
  }
});

router.post('/:id/start', requireRole('COURIER'), (req, res) => {
  const shipment = shipmentById(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (shipment.courier_user_id !== req.user.id) return res.status(403).json({ error: 'This shipment is not assigned to your account.' });
  if (shipment.status === 'OUT_FOR_DELIVERY') return res.json({ shipment, trackingStarted: true, alreadyStarted: true });
  try {
    const updated = eventStatus({ shipment, nextStatus: 'OUT_FOR_DELIVERY', actor: req.user, remarks: 'Delivery started by courier' });
    db.prepare('UPDATE courier_locations SET is_active=0 WHERE shipment_id=?').run(shipment.id);
    req.app.get('io')?.to('role:ADMIN').emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
    if (updated.customer_user_id) req.app.get('io')?.to(`shipment:${updated.id}`).emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
    return res.json({ shipment: updated, trackingStarted: true });
  } catch (e) {
    return res.status(e.statusCode || 400).json({ error: e.message, code: e.code || 'START_FAILED' });
  }
});

module.exports = { router, hasShipmentAccess };
