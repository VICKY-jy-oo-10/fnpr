'use strict';
const { db } = require('../db');
const crypto = require('node:crypto');

function audit({ actor, action, entityType, entityId, oldValue = null, newValue = null }) {
  db.prepare(`INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(actor?.id || null, actor?.role || 'SYSTEM', action, entityType, String(entityId),
      oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue));
}

function notify(userId, title, message, kind = 'INFO') {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO notifications (id, user_id, title, message, kind) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId || null, title, message, kind);
  return { id, userId, title, message, kind };
}

function queueSync(entityType, entityId, action) {
  db.prepare(`INSERT INTO sync_queue (entity_type, entity_id, action, state, attempts)
    VALUES (?, ?, ?, 'SYNCED', 1)`).run(entityType, String(entityId), action);
}

module.exports = { audit, notify, queueSync };
