const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const { truck_id, from_date, to_date, limit } = req.query;
  let sql = `
    SELECT tr.*, t.plate as truck_plate, t.name as truck_name, u.name as logged_by_name
    FROM trips tr
    JOIN trucks t ON t.id = tr.truck_id
    JOIN users u ON u.id = tr.logged_by
    WHERE 1=1
  `;
  const params = [];

  if (truck_id) { sql += ' AND tr.truck_id = ?'; params.push(truck_id); }
  if (from_date) { sql += ' AND tr.trip_date >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND tr.trip_date <= ?'; params.push(to_date); }

  sql += ' ORDER BY tr.trip_date DESC, tr.created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }

  res.json(db.prepare(sql).all(...params));
});

router.post('/', authenticate, requireRole('admin', 'staff'), (req, res) => {
  const { truck_id, customer_name, origin, destination, distance_km, fuel_litres, fuel_cost, customer_charge, expenses, trip_date, notes } = req.body;

  if (!truck_id || !customer_name || !origin || !destination || !distance_km || !fuel_litres || !trip_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const truck = db.prepare('SELECT * FROM trucks WHERE id = ? AND active = 1').get(truck_id);
  if (!truck) return res.status(400).json({ error: 'Invalid truck' });

  const result = db.prepare(`
    INSERT INTO trips (truck_id, logged_by, customer_name, origin, destination, distance_km, fuel_litres, fuel_cost, customer_charge, expenses, trip_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(truck_id, req.user.id, customer_name, origin, destination, distance_km, fuel_litres, fuel_cost || 0, customer_charge || 0, expenses || 0, trip_date, notes || null);

  res.json({ id: result.lastInsertRowid, truck_plate: truck.plate });
});

router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const { truck_id, customer_name, origin, destination, distance_km, fuel_litres, fuel_cost, customer_charge, expenses, trip_date, notes } = req.body;
  db.prepare(`
    UPDATE trips SET truck_id=?, customer_name=?, origin=?, destination=?, distance_km=?, fuel_litres=?, fuel_cost=?, customer_charge=?, expenses=?, trip_date=?, notes=?
    WHERE id=?
  `).run(
    truck_id || trip.truck_id, customer_name || trip.customer_name,
    origin || trip.origin, destination || trip.destination,
    distance_km || trip.distance_km, fuel_litres || trip.fuel_litres,
    fuel_cost !== undefined ? fuel_cost : trip.fuel_cost,
    customer_charge !== undefined ? customer_charge : trip.customer_charge,
    expenses !== undefined ? expenses : trip.expenses,
    trip_date || trip.trip_date,
    notes !== undefined ? notes : trip.notes, req.params.id
  );
  res.json({ success: true });
});

router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  const result = db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Trip not found' });
  res.json({ success: true });
});

router.get('/export/csv', authenticate, (req, res) => {
  const { truck_id, from_date, to_date } = req.query;
  let sql = `
    SELECT tr.trip_date, t.plate, tr.origin, tr.destination, tr.distance_km, tr.fuel_litres, tr.fuel_cost, tr.customer_charge, tr.expenses, tr.customer_name, u.name as logged_by
    FROM trips tr JOIN trucks t ON t.id = tr.truck_id JOIN users u ON u.id = tr.logged_by WHERE 1=1
  `;
  const params = [];
  if (truck_id) { sql += ' AND tr.truck_id = ?'; params.push(truck_id); }
  if (from_date) { sql += ' AND tr.trip_date >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND tr.trip_date <= ?'; params.push(to_date); }
  sql += ' ORDER BY tr.trip_date DESC';

  const rows = db.prepare(sql).all(...params);
  const header = 'Date,Truck,From,To,Distance (km),Fuel (L),Fuel Cost (₦),Charge (₦),Expenses (₦),Net Profit (₦),Customer,Logged By\n';
  const csv = header + rows.map(r => {
    const net = (r.customer_charge || 0) - (r.fuel_cost || 0) - (r.expenses || 0);
    return `${r.trip_date},"${r.plate}","${r.origin}","${r.destination}",${r.distance_km},${r.fuel_litres},${r.fuel_cost},${r.customer_charge || 0},${r.expenses || 0},${net},"${r.customer_name}","${r.logged_by}"`;
  }).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=trips.csv');
  res.send(csv);
});

module.exports = router;
