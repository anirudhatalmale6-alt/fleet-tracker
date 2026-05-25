const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', authenticate, (req, res) => {
  const { from_date, to_date } = req.query;
  let where = '';
  const params = [];
  if (from_date) { where += ' AND trip_date >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND trip_date <= ?'; params.push(to_date); }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_trips,
      COALESCE(SUM(distance_km), 0) as total_km,
      COALESCE(SUM(fuel_litres), 0) as total_fuel,
      COALESCE(SUM(fuel_cost), 0) as total_fuel_cost,
      COALESCE(SUM(customer_charge), 0) as total_revenue,
      COALESCE(SUM(expenses), 0) as total_expenses,
      COALESCE(SUM(customer_charge), 0) - COALESCE(SUM(fuel_cost), 0) - COALESCE(SUM(expenses), 0) as net_profit,
      CASE WHEN SUM(fuel_litres) > 0 THEN ROUND(SUM(distance_km) / SUM(fuel_litres), 1) ELSE 0 END as avg_efficiency
    FROM trips WHERE 1=1 ${where}
  `).get(...params);

  res.json(stats);
});

router.get('/weekly', authenticate, (req, res) => {
  const weeks = db.prepare(`
    SELECT
      strftime('%Y-W%W', trip_date) as week,
      MIN(trip_date) as week_start,
      COUNT(*) as trips,
      COALESCE(SUM(distance_km), 0) as km,
      COALESCE(SUM(fuel_litres), 0) as fuel
    FROM trips
    WHERE trip_date >= date('now', '-8 weeks')
    GROUP BY strftime('%Y-W%W', trip_date)
    ORDER BY week ASC
  `).all();
  res.json(weeks);
});

router.get('/by-truck', authenticate, (req, res) => {
  const { from_date, to_date } = req.query;
  let where = '';
  const params = [];
  if (from_date) { where += ' AND tr.trip_date >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND tr.trip_date <= ?'; params.push(to_date); }

  const data = db.prepare(`
    SELECT t.id, t.plate, t.name,
      COUNT(tr.id) as trips,
      COALESCE(SUM(tr.distance_km), 0) as km,
      COALESCE(SUM(tr.fuel_litres), 0) as fuel,
      COALESCE(SUM(tr.fuel_cost), 0) as fuel_cost,
      COALESCE(SUM(tr.customer_charge), 0) as revenue,
      COALESCE(SUM(tr.expenses), 0) as expenses
    FROM trucks t
    LEFT JOIN trips tr ON tr.truck_id = t.id ${where ? 'AND' + where.substring(4) : ''}
    WHERE t.active = 1
    GROUP BY t.id
  `).all(...params);
  res.json(data);
});

module.exports = router;
