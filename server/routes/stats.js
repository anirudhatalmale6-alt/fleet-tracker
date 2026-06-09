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
      COALESCE(SUM(tr.customer_charge), 0) as total_price,
      COALESCE(SUM(tr.haulage), 0) as total_haulage,
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
  expTotals.forEach(e => { by_category[e.category] = e.total; total_expenses += e.total; });
  const gross_profit = stats.total_price - total_expenses;
  const driver_motoboy = gross_profit > 0 ? Math.round(gross_profit / 3) : 0;
  const owner_share = gross_profit - driver_motoboy;
  const owner_total = owner_share + stats.total_haulage;

  res.json({
    ...stats,
    total_expenses,
    gross_profit,
    driver_motoboy,
    owner_share,
    owner_total,
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
      COALESCE(SUM(tr.customer_charge), 0) as revenue,
      COALESCE(SUM(tr.haulage), 0) as haulage
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

  res.json(trucks.map(t => {
    const exp = expMap[t.id] || 0;
    const gross = t.revenue - exp;
    const driver = gross > 0 ? Math.round(gross / 3) : 0;
    const ownerShare = gross - driver;
    return { ...t, total_expenses: exp, gross_profit: gross, driver_motoboy: driver, owner_total: ownerShare + t.haulage };
  }));
});

module.exports = router;
