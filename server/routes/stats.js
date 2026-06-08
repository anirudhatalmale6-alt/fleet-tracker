const express = require('express');
const db = require('../db');
const { EXPENSE_CATEGORIES } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', authenticate, (req, res) => {
  const { from_date, to_date } = req.query;
  let where = '';
  const params = [];
  if (from_date) { where += ' AND tr.trip_date >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND tr.trip_date <= ?'; params.push(to_date); }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_trips,
      COALESCE(SUM(tr.distance_km), 0) as total_km,
      COALESCE(SUM(tr.fuel_litres), 0) as total_fuel,
      COALESCE(SUM(tr.customer_charge), 0) + COALESCE(SUM(tr.haulage), 0) as total_revenue,
      CASE WHEN SUM(tr.fuel_litres) > 0 THEN ROUND(SUM(tr.distance_km) / SUM(tr.fuel_litres), 1) ELSE 0 END as avg_efficiency
    FROM trips tr WHERE 1=1 ${where}
  `).get(...params);

  const expTotals = db.prepare(`
    SELECT te.category, COALESCE(SUM(te.amount), 0) as total
    FROM trip_expenses te
    JOIN trips tr ON tr.id = te.trip_id
    WHERE 1=1 ${where}
    GROUP BY te.category
  `).all(...params);

  const by_category = {};
  let total_expenses = 0;
  let driver_motoboy = 0;
  expTotals.forEach(e => { by_category[e.category] = e.total; total_expenses += e.total; if (e.category === 'driver_motoboy') driver_motoboy = e.total; });
  const expenses_excl_driver = total_expenses - driver_motoboy;
  const gross_profit = stats.total_revenue - expenses_excl_driver;
  const net_profit = gross_profit - driver_motoboy;

  res.json({
    ...stats,
    total_expenses,
    driver_motoboy,
    gross_profit,
    net_profit,
    expenses_by_category: by_category
  });
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

  const trucks = db.prepare(`
    SELECT t.id, t.plate, t.name,
      COUNT(tr.id) as trips,
      COALESCE(SUM(tr.distance_km), 0) as km,
      COALESCE(SUM(tr.fuel_litres), 0) as fuel,
      COALESCE(SUM(tr.customer_charge), 0) + COALESCE(SUM(tr.haulage), 0) as revenue
    FROM trucks t
    LEFT JOIN trips tr ON tr.truck_id = t.id ${where ? 'AND' + where.substring(4) : ''}
    WHERE t.active = 1
    GROUP BY t.id
  `).all(...params);

  const truckExpenses = db.prepare(`
    SELECT tr.truck_id, COALESCE(SUM(te.amount), 0) as total_expenses
    FROM trip_expenses te
    JOIN trips tr ON tr.id = te.trip_id
    WHERE 1=1 ${where.replace(/tr\./g, 'tr.')}
    GROUP BY tr.truck_id
  `).all(...params);

  const expMap = {};
  truckExpenses.forEach(e => { expMap[e.truck_id] = e.total_expenses; });

  res.json(trucks.map(t => ({
    ...t,
    total_expenses: expMap[t.id] || 0,
    net_profit: t.revenue - (expMap[t.id] || 0)
  })));
});

module.exports = router;
