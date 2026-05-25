const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fleet.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    fuel_cost REAL DEFAULT 0,
    trip_date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at DATETIME NOT NULL
  );
`);

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
