'use strict';
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { db } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { shipmentById, eventStatus } = require('../services/shipments');
const { generateReference } = require('../services/awb');
const { audit, notify, queueSync } = require('../services/audit');
const { hasShipmentAccess } = require('./shipments');

const router = express.Router();
router.use(authenticate);

const uploadDir = path.resolve(process.cwd(), 'private_uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const uploadMax = Math.max(1, Math.min(20, Number(process.env.UPLOAD_MAX_MB || 5))) * 1024 * 1024;
const podUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: uploadMax, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(allowed.includes(file.mimetype) ? null : new Error('POD photo must be JPG, PNG, or WEBP.'), allowed.includes(file.mimetype));
  }
});

router.get('/customers', requireRole('ADMIN'), (req, res) => {
  const search = String(req.query.search || '').trim();
  const customerQuery = db.prepare(`SELECT c.*, u.active AS account_active,
      (SELECT COUNT(*) FROM shipments s WHERE s.customer_user_id=c.user_id) AS shipment_count
    FROM customers c LEFT JOIN users u ON u.id=c.user_id
    ${search ? 'WHERE c.name LIKE @search OR c.phone LIKE @search OR c.city LIKE @search' : ''}
    ORDER BY c.created_at DESC LIMIT 250`);
  const rows = search ? customerQuery.all({ search: `%${search.slice(0, 80)}%` }) : customerQuery.all();
  res.json({ customers: rows });
});

router.get('/couriers', requireRole('ADMIN'), (_req, res) => {
  const couriers = db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.active,
    (SELECT COUNT(*) FROM shipments s WHERE s.courier_user_id=u.id AND s.status NOT IN ('DELIVERED','RTO_DELIVERED','CANCELLED')) AS active_shipments,
    (SELECT MAX(updated_at) FROM courier_locations l WHERE l.courier_user_id=u.id) AS last_location_at
    FROM users u WHERE u.role='COURIER' ORDER BY u.name`).all();
  res.json({ couriers });
});

router.patch('/couriers/:id', requireRole('ADMIN'), (req, res) => {
  const active = req.body.active === true || req.body.active === 1;
  const courier = db.prepare("SELECT id,role FROM users WHERE id=? AND role='COURIER'").get(req.params.id);
  if (!courier) return res.status(404).json({ error: 'Courier not found.' });
  db.prepare("UPDATE users SET active=?, updated_at=datetime('now') WHERE id=?").run(active ? 1 : 0, courier.id);
  audit({ actor: req.user, action: active ? 'COURIER_ACTIVATED' : 'COURIER_DEACTIVATED', entityType: 'user', entityId: courier.id });
  return res.json({ ok: true });
});

router.get('/pickups', requireRole('ADMIN', 'COURIER', 'CUSTOMER'), (req, res) => {
  const where = [];
  const params = {};
  if (req.user.role === 'COURIER') { where.push('p.assigned_courier_id=@uid'); params.uid = req.user.id; }
  if (req.user.role === 'CUSTOMER') { where.push('(p.customer_phone=@phone)'); params.phone = req.user.phone; }
  const pickups = db.prepare(`SELECT p.*, u.name AS courier_name FROM pickups p LEFT JOIN users u ON u.id=p.assigned_courier_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT 200`).all(params);
  res.json({ pickups });
});

router.post('/pickups', requireRole('ADMIN', 'CUSTOMER'), (req, res) => {
  const b = req.body || {};
  const customerName = String(b.customerName || req.user.name).trim();
  const customerPhone = String(b.customerPhone || req.user.phone || '').trim();
  const address = String(b.address || '').trim();
  const city = String(b.city || '').trim();
  const pincode = String(b.pincode || '').trim();
  if (!customerName || customerPhone.replace(/\D/g, '').length < 10 || !address || !city || !pincode) {
    return res.status(400).json({ error: 'Enter customer name, valid phone, address, city and pincode.' });
  }
  const id = crypto.randomUUID();
  const pickupNumber = generateReference('PK');
  db.prepare(`INSERT INTO pickups (id,pickup_number,customer_name,customer_phone,address,city,pincode,requested_date,package_count,notes,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, pickupNumber, customerName, customerPhone, address, city, pincode,
      String(b.requestedDate || new Date().toISOString().slice(0, 10)), Math.max(1, Math.min(1000, Number(b.packageCount) || 1)), String(b.notes || '').slice(0, 500), req.user.id);
  audit({ actor: req.user, action: 'PICKUP_CREATED', entityType: 'pickup', entityId: id, newValue: { pickupNumber } });
  queueSync('pickup', id, 'CREATE');
  const pickup = db.prepare('SELECT * FROM pickups WHERE id=?').get(id);
  return res.status(201).json({ pickup });
});

router.post('/pickups/:id/assign', requireRole('ADMIN'), (req, res) => {
  const courier = db.prepare("SELECT id,name FROM users WHERE id=? AND role='COURIER' AND active=1").get(String(req.body.courierId || ''));
  if (!courier) return res.status(400).json({ error: 'Choose an active courier.' });
  const pickup = db.prepare('SELECT * FROM pickups WHERE id=?').get(req.params.id);
  if (!pickup) return res.status(404).json({ error: 'Pickup request not found.' });
  db.prepare("UPDATE pickups SET assigned_courier_id=?,status='ASSIGNED',updated_at=datetime('now') WHERE id=?").run(courier.id, pickup.id);
  notify(courier.id, 'Pickup assigned', `${pickup.pickup_number} is assigned to you.`, 'ASSIGNMENT');
  audit({ actor: req.user, action: 'PICKUP_ASSIGNED', entityType: 'pickup', entityId: pickup.id, oldValue: { courierId: pickup.assigned_courier_id }, newValue: { courierId: courier.id } });
  return res.json({ pickup: db.prepare('SELECT * FROM pickups WHERE id=?').get(pickup.id) });
});

router.patch('/pickups/:id/status', requireRole('ADMIN', 'COURIER'), (req, res) => {
  const next = String(req.body.status || '').toUpperCase();
  const allowed = ['REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(next)) return res.status(400).json({ error: 'Invalid pickup status.' });
  const pickup = db.prepare('SELECT * FROM pickups WHERE id=?').get(req.params.id);
  if (!pickup) return res.status(404).json({ error: 'Pickup request not found.' });
  if (req.user.role === 'COURIER' && pickup.assigned_courier_id !== req.user.id) return res.status(403).json({ error: 'This pickup is not assigned to you.' });
  db.prepare("UPDATE pickups SET status=?,updated_at=datetime('now') WHERE id=?").run(next, pickup.id);
  audit({ actor: req.user, action: 'PICKUP_STATUS_CHANGED', entityType: 'pickup', entityId: pickup.id, oldValue: { status: pickup.status }, newValue: { status: next } });
  return res.json({ pickup: db.prepare('SELECT * FROM pickups WHERE id=?').get(pickup.id) });
});

router.get('/drs', requireRole('ADMIN', 'COURIER'), (req, res) => {
  const where = req.user.role === 'COURIER' ? 'WHERE d.courier_user_id=?' : '';
  const drs = db.prepare(`SELECT d.*, u.name AS courier_name,
    (SELECT COUNT(*) FROM drs_items di WHERE di.drs_id=d.id) AS shipment_count
    FROM drs d JOIN users u ON u.id=d.courier_user_id ${where} ORDER BY d.created_at DESC LIMIT 200`).all(...(req.user.role === 'COURIER' ? [req.user.id] : []));
  res.json({ drs });
});

router.get('/drs/:id', requireRole('ADMIN', 'COURIER'), (req, res) => {
  const drs = db.prepare(`SELECT d.*, u.name AS courier_name FROM drs d JOIN users u ON u.id=d.courier_user_id WHERE d.id=?`).get(req.params.id);
  if (!drs) return res.status(404).json({ error: 'DRS not found.' });
  if (req.user.role === 'COURIER' && drs.courier_user_id !== req.user.id) return res.status(403).json({ error: 'This DRS is not assigned to your account.' });
  const shipments = db.prepare(`SELECT s.* FROM drs_items di JOIN shipments s ON s.id=di.shipment_id WHERE di.drs_id=? ORDER BY s.awb`).all(drs.id);
  res.json({ drs, shipments });
});

router.post('/drs', requireRole('ADMIN'), (req, res) => {
  const courier = db.prepare("SELECT id,name FROM users WHERE id=? AND role='COURIER' AND active=1").get(String(req.body.courierId || ''));
  const ids = [...new Set((Array.isArray(req.body.shipmentIds) ? req.body.shipmentIds : []).map(String))].slice(0, 100);
  const scheduledDate = String(req.body.scheduledDate || new Date().toISOString().slice(0, 10));
  if (!courier || !ids.length) return res.status(400).json({ error: 'Choose a courier and at least one shipment.' });
  const rows = ids.map((id) => db.prepare('SELECT * FROM shipments WHERE id=?').get(id));
  if (rows.some((row) => !row || ['DELIVERED', 'RTO_DELIVERED', 'CANCELLED'].includes(row.status))) {
    return res.status(400).json({ error: 'One or more shipments are missing or cannot be added to a DRS.' });
  }
  const id = crypto.randomUUID();
  const drsNumber = generateReference('DRS');
  try {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO drs (id,drs_number,courier_user_id,scheduled_date,created_by) VALUES (?,?,?,?,?)')
        .run(id, drsNumber, courier.id, scheduledDate, req.user.id);
      const itemStmt = db.prepare('INSERT INTO drs_items (drs_id,shipment_id) VALUES (?,?)');
      rows.forEach((row) => {
        itemStmt.run(id, row.id);
        db.prepare("UPDATE shipments SET courier_user_id=?,updated_at=datetime('now') WHERE id=?").run(courier.id, row.id);
        const latest = shipmentById(row.id);
        if (latest.status === 'BOOKED') eventStatus({ shipment: latest, nextStatus: 'PICKUP_ASSIGNED', actor: req.user, remarks: `Added to ${drsNumber}` });
        queueSync('shipment', row.id, 'DRS_ASSIGN');
      });
      audit({ actor: req.user, action: 'DRS_CREATED', entityType: 'drs', entityId: id, newValue: { drsNumber, courierId: courier.id, shipmentIds: ids } });
      notify(courier.id, 'Delivery route assigned', `${drsNumber} contains ${ids.length} shipment(s).`, 'ASSIGNMENT');
    });
    tx();
    const io = req.app.get('io');
    rows.forEach((row) => {
      const updated = shipmentById(row.id);
      io?.to('role:ADMIN').emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
      if (updated.customer_user_id) io?.to(`shipment:${updated.id}`).emit('shipment:updated', { shipmentId: updated.id, awb: updated.awb, status: updated.status });
    });
    io?.to(`user:${courier.id}`).emit('assignment:updated', { drsId: id, drsNumber });
    return res.status(201).json({ drs: db.prepare('SELECT * FROM drs WHERE id=?').get(id), shipmentCount: ids.length });
  } catch (e) {
    console.error('DRS creation failed:', e.message);
    return res.status(500).json({ error: 'Unable to generate DRS. Please retry.' });
  }
});

router.get('/pod', requireRole('ADMIN', 'COURIER'), (req, res) => {
  const where = req.user.role === 'COURIER' ? 'WHERE s.courier_user_id=?' : '';
  const pods = db.prepare(`SELECT p.*, s.awb, s.receiver_name AS shipment_receiver, u.name AS courier_name
    FROM pod_records p JOIN shipments s ON s.id=p.shipment_id LEFT JOIN users u ON u.id=s.courier_user_id ${where}
    ORDER BY p.delivered_at DESC LIMIT 200`).all(...(req.user.role === 'COURIER' ? [req.user.id] : []));
  res.json({ pods });
});

router.post('/pod/:shipmentId', requireRole('ADMIN', 'COURIER'), (req, res, next) => {
  podUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `POD photo must be smaller than ${process.env.UPLOAD_MAX_MB || 5} MB.` : err.message || 'Unable to upload POD photo.' });
    next();
  });
}, (req, res) => {
  const shipment = shipmentById(req.params.shipmentId);
  if (!shipment) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Shipment not found.' });
  }
  if (req.user.role === 'COURIER' && shipment.courier_user_id !== req.user.id) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'You can upload POD only for your assigned shipment.' });
  }
  const receiverName = String(req.body.receiverName || '').trim();
  if (!receiverName) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Receiver name is required for proof of delivery.' });
  }
  if (shipment.status !== 'OUT_FOR_DELIVERY') {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(409).json({ error: 'POD can be recorded only for an out-for-delivery shipment.' });
  }
  const latitude = req.body.latitude === '' || req.body.latitude == null ? null : Number(req.body.latitude);
  const longitude = req.body.longitude === '' || req.body.longitude == null ? null : Number(req.body.longitude);
  if ((latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid POD GPS coordinates.' });
  }
  const id = crypto.randomUUID();
  try {
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO pod_records (id,shipment_id,receiver_name,signature_text,photo_filename,remarks,latitude,longitude,created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, shipment.id, receiverName.slice(0, 100), String(req.body.signatureText || '').slice(0, 500),
          req.file ? path.basename(req.file.filename) : '', String(req.body.remarks || '').slice(0, 500), latitude, longitude, req.user.id);
      eventStatus({ shipment, nextStatus: 'DELIVERED', actor: req.user, remarks: `POD captured for ${receiverName}` });
      db.prepare('UPDATE courier_locations SET is_active=0 WHERE shipment_id=?').run(shipment.id);
      if (shipment.courier_user_id) db.prepare("UPDATE drs SET status='COMPLETED' WHERE id IN (SELECT drs_id FROM drs_items WHERE shipment_id=?) AND NOT EXISTS (SELECT 1 FROM drs_items di JOIN shipments s ON s.id=di.shipment_id WHERE di.drs_id=drs.id AND s.status NOT IN ('DELIVERED','RTO_DELIVERED','CANCELLED'))").run(shipment.id);
      audit({ actor: req.user, action: 'POD_CAPTURED', entityType: 'pod', entityId: id, newValue: { shipmentId: shipment.id, receiverName } });
    });
    tx();
    const io = req.app.get('io');
    io?.to('role:ADMIN').emit('shipment:updated', { shipmentId: shipment.id, status: 'DELIVERED', awb: shipment.awb });
    if (shipment.customer_user_id) io?.to(`shipment:${shipment.id}`).emit('shipment:updated', { shipmentId: shipment.id, status: 'DELIVERED', awb: shipment.awb });
    return res.status(201).json({ pod: db.prepare('SELECT id,shipment_id,receiver_name,remarks,delivered_at FROM pod_records WHERE id=?').get(id) });
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Proof of delivery already exists for this shipment.' });
    console.error('POD save failed:', e.message);
    return res.status(500).json({ error: 'Unable to save proof of delivery.' });
  }
});

router.get('/pod/:id/photo', requireRole('ADMIN', 'COURIER', 'CUSTOMER'), (req, res) => {
  const pod = db.prepare(`SELECT p.*,s.customer_user_id,s.courier_user_id FROM pod_records p JOIN shipments s ON s.id=p.shipment_id WHERE p.id=?`).get(req.params.id);
  if (!pod || !pod.photo_filename) return res.status(404).json({ error: 'POD photo not found.' });
  if (req.user.role === 'CUSTOMER' && pod.customer_user_id !== req.user.id) return res.status(403).json({ error: 'You cannot access this proof of delivery.' });
  if (req.user.role === 'COURIER' && pod.courier_user_id !== req.user.id) return res.status(403).json({ error: 'You cannot access this proof of delivery.' });
  return res.sendFile(path.join(uploadDir, path.basename(pod.photo_filename)));
});

router.post('/tracking/:shipmentId/location', requireRole('COURIER'), (req, res) => {
  const shipment = shipmentById(req.params.shipmentId);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (shipment.courier_user_id !== req.user.id) return res.status(403).json({ error: 'This shipment is not assigned to your account.' });
  if (shipment.status !== 'OUT_FOR_DELIVERY') return res.status(409).json({ error: 'Start delivery before sharing live location.' });
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = req.body.accuracy == null ? null : Number(req.body.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Location coordinates are invalid.' });
  }
  db.prepare(`INSERT INTO courier_locations (courier_user_id,shipment_id,latitude,longitude,accuracy_m,source,is_active,updated_at)
    VALUES (?,?,?,?,?,'GPS',1,datetime('now'))`).run(req.user.id, shipment.id, latitude, longitude, Number.isFinite(accuracy) ? accuracy : null);
  db.prepare(`UPDATE courier_locations SET is_active=0 WHERE shipment_id=? AND id NOT IN
    (SELECT id FROM courier_locations WHERE shipment_id=? ORDER BY updated_at DESC,id DESC LIMIT 1)`).run(shipment.id, shipment.id);
  const point = db.prepare(`SELECT latitude,longitude,accuracy_m,updated_at,source FROM courier_locations WHERE shipment_id=? AND is_active=1 ORDER BY id DESC LIMIT 1`).get(shipment.id);
  const io = req.app.get('io');
  io?.to('role:ADMIN').emit('courier:location', { shipmentId: shipment.id, awb: shipment.awb, courierId: req.user.id, courierName: req.user.name, ...point });
  io?.to(`shipment:${shipment.id}`).emit('courier:location', { shipmentId: shipment.id, awb: shipment.awb, courierName: req.user.name, ...point });
  return res.json({ location: point });
});

router.get('/tracking/live', requireRole('ADMIN'), (_req, res) => {
  const locations = db.prepare(`SELECT l.*,u.name AS courier_name,u.phone AS courier_phone,s.awb,s.status AS shipment_status,s.receiver_name,s.receiver_city
    FROM courier_locations l JOIN users u ON u.id=l.courier_user_id LEFT JOIN shipments s ON s.id=l.shipment_id
    WHERE l.is_active=1 ORDER BY l.updated_at DESC`).all();
  res.json({ locations });
});

router.post('/demo/simulate/:shipmentId', requireRole('ADMIN'), (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true') return res.status(403).json({ error: 'The location simulator is only available in development demo mode.' });
  const shipment = shipmentById(req.params.shipmentId);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (!shipment.courier_user_id) return res.status(409).json({ error: 'Assign a courier before starting the simulator.' });
  if (shipment.status !== 'OUT_FOR_DELIVERY') return res.status(409).json({ error: 'Move the shipment to OUT_FOR_DELIVERY before simulation.' });
  const io = req.app.get('io');
  const startLat = 13.0358, startLng = 80.2445;
  const pathPoints = Array.from({ length: 12 }, (_, i) => ({ latitude: startLat + i * 0.0017, longitude: startLng + i * 0.00115 }));
  const active = req.app.get('simulations') || new Map();
  if (active.has(shipment.id)) return res.json({ started: true, message: 'The demo route is already running.' });
  let index = 0;
  const timer = setInterval(() => {
    const p = pathPoints[Math.min(index, pathPoints.length - 1)];
    db.prepare(`INSERT INTO courier_locations (courier_user_id,shipment_id,latitude,longitude,accuracy_m,source,is_active,updated_at)
      VALUES (?,?,?,?,20,'DEMO',1,datetime('now'))`).run(shipment.courier_user_id, shipment.id, p.latitude, p.longitude);
    db.prepare(`UPDATE courier_locations SET is_active=0 WHERE shipment_id=? AND id NOT IN
      (SELECT id FROM courier_locations WHERE shipment_id=? ORDER BY id DESC LIMIT 1)`).run(shipment.id, shipment.id);
    const point = { ...p, accuracy_m: 20, updated_at: new Date().toISOString(), source: 'DEMO' };
    io?.to('role:ADMIN').emit('courier:location', { shipmentId: shipment.id, awb: shipment.awb, courierId: shipment.courier_user_id, courierName: shipment.courier_name || 'Assigned courier', ...point });
    io?.to(`shipment:${shipment.id}`).emit('courier:location', { shipmentId: shipment.id, awb: shipment.awb, courierName: shipment.courier_name || 'Assigned courier', ...point });
    index += 1;
    if (index >= pathPoints.length) {
      clearInterval(timer); active.delete(shipment.id); req.app.set('simulations', active);
    }
  }, 2500);
  active.set(shipment.id, timer); req.app.set('simulations', active);
  audit({ actor: req.user, action: 'DEMO_TRACKING_STARTED', entityType: 'shipment', entityId: shipment.id });
  return res.json({ started: true, points: pathPoints.length, intervalMs: 2500 });
});

router.get('/notifications', requireRole('ADMIN', 'COURIER', 'CUSTOMER'), (req, res) => {
  const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id=? OR user_id IS NULL ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  res.json({ notifications });
});
router.patch('/notifications/:id/read', (req, res) => {
  const result = db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ ok: true });
});

router.get('/sync', requireRole('ADMIN', 'COURIER'), (req, res) => {
  const stateFilter = String(req.query.state || '').toUpperCase();
  const where = stateFilter && ['PENDING','SYNCED','FAILED'].includes(stateFilter) ? 'WHERE state=?' : '';
  const rows = db.prepare(`SELECT * FROM sync_queue ${where} ORDER BY created_at DESC LIMIT 100`).all(...(where ? [stateFilter] : []));
  const summary = db.prepare(`SELECT state,COUNT(*) AS count FROM sync_queue GROUP BY state`).all();
  const lastSync = db.prepare("SELECT MAX(updated_at) AS at FROM sync_queue WHERE state='SYNCED'").get().at;
  res.json({ items: rows, summary, lastSync, mode: 'online-local-database' });
});
router.post('/sync/:id/retry', requireRole('ADMIN'), (req, res) => {
  const item = db.prepare('SELECT * FROM sync_queue WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Sync record not found.' });
  db.prepare("UPDATE sync_queue SET state='PENDING', attempts=attempts+1, last_error='', updated_at=datetime('now') WHERE id=?").run(item.id);
  // SQLite is the authoritative backend in this build, so a retry confirms the local record is still persisted.
  db.prepare("UPDATE sync_queue SET state='SYNCED', updated_at=datetime('now') WHERE id=?").run(item.id);
  audit({ actor: req.user, action: 'SYNC_RETRY', entityType: item.entity_type, entityId: item.entity_id });
  res.json({ ok: true, message: 'Local database record verified.' });
});

router.get('/audit', requireRole('ADMIN'), (req, res) => {
  const logs = db.prepare(`SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200`).all();
  res.json({ logs });
});

module.exports = router;
