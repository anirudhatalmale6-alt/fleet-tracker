const express = require('express');
const db = require('../db');
const { EXPENSE_CATEGORIES } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function getTripsWithExpenses(trips) {
  if (trips.length === 0) return trips;
  const ids = trips.map(t => t.id);
  const exps = db.prepare(`SELECT * FROM trip_expenses WHERE trip_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const expMap = {};
  exps.forEach(e => {
    if (!expMap[e.trip_id]) expMap[e.trip_id] = {};
    expMap[e.trip_id][e.category] = e.amount;
  });
  return trips.map(t => {
    const ex = expMap[t.id] || {};
    let total_expenses = 0;
    EXPENSE_CATEGORIES.forEach(c => { total_expenses += (ex[c.key] || 0); });
    return { ...t, expenses: ex, total_expenses, net_profit: (t.customer_charge || 0) - total_expenses };
  });
}

function saveExpenses(tripId, expenses) {
  db.prepare('DELETE FROM trip_expenses WHERE trip_id = ?').run(tripId);
  const ins = db.prepare('INSERT INTO trip_expenses (trip_id, category, amount) VALUES (?, ?, ?)');
  for (const [key, amount] of Object.entries(expenses || {})) {
    const val = parseFloat(amount) || 0;
    if (val > 0) ins.run(tripId, key, val);
  }
}

router.get('/categories', authenticate, (req, res) => {
  res.json(EXPENSE_CATEGORIES);
});

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

  const trips = db.prepare(sql).all(...params);
  res.json(getTripsWithExpenses(trips));
});

router.post('/', authenticate, requireRole('admin', 'staff'), (req, res) => {
  const { truck_id, customer_name, origin, destination, distance_km, fuel_litres, customer_charge, trip_date, notes, expenses } = req.body;

  if (!truck_id || !customer_name || !origin || !destination || !distance_km || !fuel_litres || !trip_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const truck = db.prepare('SELECT * FROM trucks WHERE id = ? AND active = 1').get(truck_id);
  if (!truck) return res.status(400).json({ error: 'Invalid truck' });

  const result = db.prepare(`
    INSERT INTO trips (truck_id, logged_by, customer_name, origin, destination, distance_km, fuel_litres, customer_charge, trip_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(truck_id, req.user.id, customer_name, origin, destination, distance_km, fuel_litres, customer_charge || 0, trip_date, notes || null);

  saveExpenses(result.lastInsertRowid, expenses);
  res.json({ id: result.lastInsertRowid, truck_plate: truck.plate });
});

router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const { truck_id, customer_name, origin, destination, distance_km, fuel_litres, customer_charge, trip_date, notes, expenses } = req.body;
  db.prepare(`
    UPDATE trips SET truck_id=?, customer_name=?, origin=?, destination=?, distance_km=?, fuel_litres=?, customer_charge=?, trip_date=?, notes=?
    WHERE id=?
  `).run(
    truck_id || trip.truck_id, customer_name || trip.customer_name,
    origin || trip.origin, destination || trip.destination,
    distance_km || trip.distance_km, fuel_litres || trip.fuel_litres,
    customer_charge !== undefined ? customer_charge : trip.customer_charge,
    trip_date || trip.trip_date,
    notes !== undefined ? notes : trip.notes, req.params.id
  );
  if (expenses) saveExpenses(req.params.id, expenses);
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
    SELECT tr.*, t.plate, u.name as logged_by
    FROM trips tr JOIN trucks t ON t.id = tr.truck_id JOIN users u ON u.id = tr.logged_by WHERE 1=1
  `;
  const params = [];
  if (truck_id) { sql += ' AND tr.truck_id = ?'; params.push(truck_id); }
  if (from_date) { sql += ' AND tr.trip_date >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND tr.trip_date <= ?'; params.push(to_date); }
  sql += ' ORDER BY tr.trip_date DESC';

  const trips = getTripsWithExpenses(db.prepare(sql).all(...params));
  const catHeaders = EXPENSE_CATEGORIES.map(c => c.label).join(',');
  const header = `Date,Truck,From,To,Distance (km),Fuel (L),${catHeaders},Total Expenses (₦),Charge (₦),Net Profit (₦),Customer,Logged By\n`;
  const csv = header + trips.map(r => {
    const catValues = EXPENSE_CATEGORIES.map(c => r.expenses[c.key] || 0).join(',');
    return `${r.trip_date},"${r.plate}","${r.origin}","${r.destination}",${r.distance_km},${r.fuel_litres},${catValues},${r.total_expenses},${r.customer_charge || 0},${r.net_profit},"${r.customer_name}","${r.logged_by}"`;
  }).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=trips.csv');
  res.send(csv);
});

module.exports = router;
