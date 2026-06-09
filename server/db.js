const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fleet.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const EXPENSE_CATEGORIES = [
  { key: 'diesel', label: 'Diesel' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'car_wash', label: 'Car Wash' },
  { key: 'lagos_govt', label: 'Lagos Govt' },
  { key: 'fed_govt', label: 'Fed Govt' },
  { key: 'police', label: 'Police' },
  { key: 'community_gate', label: 'Community Gate Pass' },
  { key: 'road_safety', label: 'Road Safety' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'misc', label: 'Misc' },
];

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','staff','viewer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trucks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT UNIQUE NOT NULL,
    name TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    truck_id INTEGER NOT NULL REFERENCES trucks(id),
    logged_by INTEGER NOT NULL REFERENCES users(id),
    customer_name TEXT NOT NULL,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    distance_km REAL NOT NULL,
    fuel_litres REAL NOT NULL,
    customer_charge REAL DEFAULT 0,
    trip_date DATE NOT NULL,
    trip_number INTEGER DEFAULT 1,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trip_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at DATETIME NOT NULL
  );
`);

try { db.exec('ALTER TABLE trips ADD COLUMN haulage REAL DEFAULT 0'); } catch(e) {}

const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)').run('Admin', 'admin', hash, 'admin');
}

const truckCount = db.prepare('SELECT COUNT(*) as cnt FROM trucks').get();
if (truckCount.cnt === 0) {
  db.prepare('INSERT INTO trucks (plate, name) VALUES (?, ?)').run('TRUCK-001', 'Truck 1');
  db.prepare('INSERT INTO trucks (plate, name) VALUES (?, ?)').run('TRUCK-002', 'Truck 2');
}

module.exports = db;
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
