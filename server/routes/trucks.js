const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const trucks = db.prepare(`
    SELECT t.*,
      COALESCE(COUNT(tr.id), 0) as total_trips,
      COALESCE(SUM(tr.distance_km), 0) as total_km,
      COALESCE(SUM(tr.fuel_litres), 0) as total_fuel,
      COALESCE(SUM(tr.fuel_cost), 0) as total_fuel_cost
    FROM trucks t
    LEFT JOIN trips tr ON tr.truck_id = t.id
    WHERE t.active = 1
    GROUP BY t.id
  `).all();
  res.json(trucks);
});

router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { plate, name } = req.body;
  if (!plate) return res.status(400).json({ error: 'Plate number required' });
  try {
    const result = db.prepare('INSERT INTO trucks (plate, name) VALUES (?, ?)').run(plate.toUpperCase(), name || plate);
    res.json({ id: result.lastInsertRowid, plate: plate.toUpperCase(), name: name || plate });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Plate already exists' });
    throw e;
  }
});

router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  const { plate, name, active } = req.body;
  const truck = db.prepare('SELECT * FROM trucks WHERE id = ?').get(req.params.id);
  if (!truck) return res.status(404).json({ error: 'Truck not found' });

  db.prepare('UPDATE trucks SET plate = ?, name = ?, active = ? WHERE id = ?').run(
    plate || truck.plate, name || truck.name, active !== undefined ? active : truck.active, req.params.id
  );
  res.json({ success: true });
});

module.exports = router;
