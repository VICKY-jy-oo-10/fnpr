'use strict';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
require('dotenv').config();

const configuredPath = process.env.DB_PATH || './data/parcelpilot.sqlite';
const dbPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(process.cwd(), configuredPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE COLLATE NOCASE,
      phone TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','COURIER','CUSTOMER')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      pincode TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      awb TEXT NOT NULL UNIQUE,
      customer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      courier_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      sender_name TEXT NOT NULL,
      sender_phone TEXT NOT NULL,
      sender_address TEXT NOT NULL,
      sender_city TEXT NOT NULL,
      sender_pincode TEXT NOT NULL,
      receiver_name TEXT NOT NULL,
      receiver_phone TEXT NOT NULL,
      receiver_address TEXT NOT NULL,
      receiver_city TEXT NOT NULL,
      receiver_pincode TEXT NOT NULL,
      package_type TEXT NOT NULL DEFAULT 'Parcel',
      weight_kg REAL NOT NULL DEFAULT 1,
      dimensions TEXT DEFAULT '',
      service_type TEXT NOT NULL DEFAULT 'Standard',
      payment_mode TEXT NOT NULL DEFAULT 'Prepaid',
      amount REAL NOT NULL DEFAULT 0,
      special_instructions TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'BOOKED',
      origin_hub TEXT DEFAULT '',
      destination_hub TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      location TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pickups (
      id TEXT PRIMARY KEY,
      pickup_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      pincode TEXT NOT NULL,
      requested_date TEXT NOT NULL,
      package_count INTEGER NOT NULL DEFAULT 1,
      notes TEXT DEFAULT '',
      assigned_courier_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS drs (
      id TEXT PRIMARY KEY,
      drs_number TEXT NOT NULL UNIQUE,
      courier_user_id TEXT NOT NULL REFERENCES users(id),
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS drs_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drs_id TEXT NOT NULL REFERENCES drs(id) ON DELETE CASCADE,
      shipment_id TEXT NOT NULL REFERENCES shipments(id),
      UNIQUE(drs_id, shipment_id)
    );
    CREATE TABLE IF NOT EXISTS pod_records (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
      receiver_name TEXT NOT NULL,
      signature_text TEXT DEFAULT '',
      photo_filename TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      latitude REAL,
      longitude REAL,
      delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS courier_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courier_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shipment_id TEXT REFERENCES shipments(id) ON DELETE CASCADE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_m REAL,
      source TEXT NOT NULL DEFAULT 'GPS',
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS financial_entries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('INCOME','EXPENSE')),
      category TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount >= 0),
      reference TEXT DEFAULT '',
      description TEXT DEFAULT '',
      entry_date TEXT NOT NULL DEFAULT (date('now')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'INFO',
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'SYNCED' CHECK(state IN ('PENDING','SYNCED','FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_shipments_awb ON shipments(awb);
    CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
    CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_user_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_courier ON shipments(courier_user_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments(created_at);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_tracking_shipment ON tracking_events(shipment_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_locations_courier ON courier_locations(courier_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_finance_date ON financial_entries(entry_date);
  `);
  seedDatabase();
}

function seedDatabase() {
  // Demo identities and synthetic records must never be introduced into production databases.
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE !== 'true') return;
  const upsertStaff = db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active)
    VALUES (@id, @name, @email, @phone, @password_hash, @role, 1)
    ON CONFLICT(email) DO NOTHING
  `);
  const staff = [
    { id: 'usr_admin_demo', name: 'Amara Okafor', email: 'admin@parcelpilot.test', phone: '+919900000001', password: 'Admin@12345', role: 'ADMIN' },
    { id: 'usr_courier_1', name: 'Arun Kumar', email: 'courier@parcelpilot.test', phone: '+919900000002', password: 'Courier@12345', role: 'COURIER' },
    { id: 'usr_courier_2', name: 'Priya Devi', email: 'courier2@parcelpilot.test', phone: '+919900000003', password: 'Courier@12345', role: 'COURIER' }
  ];
  for (const person of staff) {
    upsertStaff.run({ ...person, password_hash: bcrypt.hashSync(person.password, 10) });
  }

  const customerPhone = '+919876543210';
  let customerUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(customerPhone);
  if (!customerUser) {
    const customerId = 'usr_customer_demo';
    db.prepare(`INSERT INTO users (id, name, phone, role, active) VALUES (?, ?, ?, 'CUSTOMER', 1)`)
      .run(customerId, 'Ibrahim Rahman', customerPhone);
    customerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(customerId);
  }
  db.prepare(`INSERT INTO customers (id, user_id, name, phone, email, address, city, pincode)
    VALUES ('cust_demo_1', ?, 'Ibrahim Rahman', ?, 'ibrahim@example.test', '14 Lake View Road', 'Chennai', '600028')
    ON CONFLICT(phone) DO NOTHING`).run(customerUser.id, customerPhone);

  if (db.prepare('SELECT COUNT(*) AS n FROM shipments').get().n === 0) {
    const courier1 = db.prepare("SELECT id FROM users WHERE email = 'courier@parcelpilot.test'").get();
    const courier2 = db.prepare("SELECT id FROM users WHERE email = 'courier2@parcelpilot.test'").get();
    const admin = db.prepare("SELECT id FROM users WHERE email = 'admin@parcelpilot.test'").get();
    const now = new Date();
    const seedShipments = [
      { awb: 'PP2610010001', receiver: 'Ibrahim Rahman', phone: customerPhone, city: 'Chennai', status: 'OUT_FOR_DELIVERY', courier: courier1.id, customer: customerUser.id, sender: 'Maya Stores', origin: 'Bengaluru Hub', destination: 'Chennai Hub', amount: 249 },
      { awb: 'PP2610010002', receiver: 'Ibrahim Rahman', phone: customerPhone, city: 'Chennai', status: 'IN_TRANSIT', courier: courier2.id, customer: customerUser.id, sender: 'Northstar Books', origin: 'Coimbatore Hub', destination: 'Chennai Hub', amount: 180 },
      { awb: 'PP2610010003', receiver: 'Sanjay Iyer', phone: '+919811223344', city: 'Chennai', status: 'DELIVERED', courier: courier1.id, customer: null, sender: 'Tech Bazaar', origin: 'Chennai Hub', destination: 'Chennai Hub', amount: 320 },
      { awb: 'PP2610010004', receiver: 'Divya Nair', phone: '+919811223355', city: 'Pondicherry', status: 'UNDELIVERED', courier: courier2.id, customer: null, sender: 'Urban Living', origin: 'Chennai Hub', destination: 'Pondicherry Hub', amount: 210 },
      { awb: 'PP2610010005', receiver: 'Ibrahim Rahman', phone: customerPhone, city: 'Chennai', status: 'BOOKED', courier: null, customer: customerUser.id, sender: 'Green Basket', origin: 'Chennai Hub', destination: 'Chennai Hub', amount: 150 }
    ];
    const insertShipment = db.prepare(`INSERT INTO shipments (
      id, awb, customer_user_id, created_by, courier_user_id, sender_name, sender_phone, sender_address, sender_city, sender_pincode,
      receiver_name, receiver_phone, receiver_address, receiver_city, receiver_pincode, package_type, weight_kg, dimensions,
      service_type, payment_mode, amount, special_instructions, status, origin_hub, destination_hub, created_at, updated_at, delivered_at
    ) VALUES (@id, @awb, @customer, @admin, @courier, @sender, '+919811223300', 'No. 8 Market Road', 'Bengaluru', '560001',
      @receiver, @phone, '14 Lake View Road', @city, '600028', 'Parcel', 1.2, '30 × 20 × 10 cm', 'Express', 'Prepaid', @amount,
      '', @status, @origin, @destination, @created, @created, @delivered)`);
    const insertEvent = db.prepare(`INSERT INTO tracking_events (shipment_id, status, location, remarks, actor_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction(() => {
      seedShipments.forEach((s, i) => {
        const shipmentId = `shp_demo_${i + 1}`;
        const created = new Date(now.getTime() - (i + 1) * 3600 * 1000).toISOString();
        insertShipment.run({ id: shipmentId, ...s, admin: admin.id, created, delivered: s.status === 'DELIVERED' ? created : null });
        insertEvent.run(shipmentId, 'BOOKED', s.origin, 'Shipment booked', admin.id, created);
        if (s.status !== 'BOOKED') insertEvent.run(shipmentId, s.status, s.status === 'OUT_FOR_DELIVERY' ? 'Chennai route' : s.destination, 'Demo seed status', admin.id, created);
      });
    });
    tx();
    db.prepare(`INSERT INTO pickups (id, pickup_number, customer_name, customer_phone, address, city, pincode, requested_date, package_count, notes, assigned_courier_id, status, created_by)
      VALUES ('pku_demo_1','PK-20261022-001','Ibrahim Rahman',?,'14 Lake View Road','Chennai','600028',date('now'),2,'Fragile books',?,'ASSIGNED',?)`)
      .run(customerPhone, courier1.id, admin.id);
    db.prepare(`INSERT INTO financial_entries (id, kind, category, amount, reference, description, entry_date, created_by) VALUES
      ('fin_demo_1','INCOME','Shipping fee',18450,'INV-1022','Daily shipping collections',date('now'),?),
      ('fin_demo_2','EXPENSE','Fuel',4280,'FUEL-221','Fleet fuel expense',date('now'),?),
      ('fin_demo_3','EXPENSE','Packaging',1250,'PKG-118','Packaging materials',date('now'),?)`).run(admin.id, admin.id, admin.id);
  }
}

initializeDatabase();

module.exports = { db, initializeDatabase };
