'use strict';
const { db } = require('../db');
const { audit, notify, queueSync } = require('./audit');
const { canTransition } = require('../status');

function shipmentById(id) {
  return db.prepare(`SELECT s.*, cu.name AS courier_name, cu.phone AS courier_phone,
    u.name AS customer_name, u.phone AS customer_phone
    FROM shipments s LEFT JOIN users cu ON cu.id=s.courier_user_id
    LEFT JOIN users u ON u.id=s.customer_user_id WHERE s.id=?`).get(id);
}

function eventStatus({ shipment, nextStatus, actor, remarks = '', location = '' }) {
  if (!canTransition(shipment.status, nextStatus, actor.role)) {
    const err = new Error(`Status cannot change from ${shipment.status} to ${nextStatus}.`);
    err.statusCode = 409;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
  const oldStatus = shipment.status;
  const deliveredAt = ['DELIVERED', 'RTO_DELIVERED'].includes(nextStatus) ? new Date().toISOString() : shipment.delivered_at;
  db.prepare('UPDATE shipments SET status=?, updated_at=datetime(\'now\'), delivered_at=? WHERE id=?')
    .run(nextStatus, deliveredAt || null, shipment.id);
  db.prepare(`INSERT INTO tracking_events (shipment_id, status, location, remarks, actor_user_id)
    VALUES (?, ?, ?, ?, ?)`).run(shipment.id, nextStatus, location, remarks, actor.id);
  audit({ actor, action: 'SHIPMENT_STATUS_CHANGED', entityType: 'shipment', entityId: shipment.id,
    oldValue: { status: oldStatus }, newValue: { status: nextStatus, remarks } });
  queueSync('shipment', shipment.id, 'STATUS_CHANGED');
  if (shipment.customer_user_id) {
    notify(shipment.customer_user_id, 'Shipment status updated', `${shipment.awb} is now ${nextStatus.replaceAll('_', ' ').toLowerCase()}.`, 'SHIPMENT');
  }
  return shipmentById(shipment.id);
}

module.exports = { shipmentById, eventStatus };
