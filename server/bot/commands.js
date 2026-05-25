const db = require('../db');

function formatNumber(n) {
  return Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function parseLogMessage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const data = {};
  for (const line of lines) {
    const match = line.match(/^(\w[\w\s]*?):\s*(.+)$/i);
    if (match) {
      const key = match[1].toLowerCase().trim();
      const val = match[2].trim();
      if (key === 'truck') data.truck = val.toUpperCase();
      else if (key === 'date') data.date = val;
      else if (key === 'from') data.origin = val;
      else if (key === 'to') data.destination = val;
      else if (key === 'distance') data.distance = parseFloat(val);
      else if (key === 'fuel') data.fuel = parseFloat(val);
      else if (key === 'cost' || key === 'fuel cost') data.fuel_cost = parseFloat(val.replace(/[₦,]/g, ''));
      else if (key === 'customer') data.customer = val;
      else if (key === 'charge' || key === 'price' || key === 'customer charge' || key === 'amount') data.customer_charge = parseFloat(val.replace(/[₦,#]/g, ''));
      else if (key === 'expenses' || key === 'expense' || key === 'other expenses') data.expenses = parseFloat(val.replace(/[₦,#]/g, ''));
      else if (key === 'notes' || key === 'note') data.notes = val;
    }
  }
  return data;
}

function handleMessage(phoneNumber, messageText) {
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phoneNumber);
  if (!user) {
    return 'You are not registered. Contact your admin to get access.';
  }

  const text = messageText.trim();
  const command = text.split('\n')[0].toUpperCase().trim();

  if (command === 'HELP') {
    return `Fleet Tracker Commands:

LOG
Truck: PLATE
Date: DD/MM/YYYY
From: Location
To: Location
Distance: km
Fuel: litres
Cost: fuel cost in Naira
Charge: amount charged to customer
Expenses: other expenses in Naira
Customer: Name

REPORT - This month summary
REPORT WEEK - This week
REPORT TODAY - Today only
TRUCKS - List all trucks
HELP - Show this message`;
  }

  if (command.startsWith('REPORT')) {
    return handleReport(command, user);
  }

  if (command === 'TRUCKS') {
    const trucks = db.prepare(`
      SELECT t.*, COUNT(tr.id) as trips, COALESCE(SUM(tr.distance_km),0) as km
      FROM trucks t LEFT JOIN trips tr ON tr.truck_id = t.id
      WHERE t.active = 1 GROUP BY t.id
    `).all();
    if (trucks.length === 0) return 'No trucks registered yet.';
    let msg = 'Your Trucks:\n';
    trucks.forEach(t => {
      msg += `\n${t.name} (${t.plate})\n  ${t.trips} trips | ${formatNumber(t.km)} km\n`;
    });
    return msg;
  }

  if (command === 'LOG') {
    if (!['admin', 'staff'].includes(user.role)) {
      return 'You do not have permission to log trips. Contact your admin.';
    }
    return handleLog(text, user);
  }

  return `Unknown command. Send HELP for available commands.`;
}

function handleLog(text, user) {
  const data = parseLogMessage(text);
  const missing = [];
  if (!data.truck) missing.push('Truck');
  if (!data.origin) missing.push('From');
  if (!data.destination) missing.push('To');
  if (!data.distance) missing.push('Distance');
  if (!data.fuel) missing.push('Fuel');
  if (!data.customer) missing.push('Customer');

  if (missing.length > 0) {
    return `Missing fields: ${missing.join(', ')}\n\nPlease resend with all fields. Send HELP for the format.`;
  }

  const truck = db.prepare('SELECT * FROM trucks WHERE plate = ? AND active = 1').get(data.truck);
  if (!truck) {
    const trucks = db.prepare('SELECT plate, name FROM trucks WHERE active = 1').all();
    let msg = `Truck "${data.truck}" not found.\n\nAvailable trucks:\n`;
    trucks.forEach(t => { msg += `  ${t.plate} (${t.name})\n`; });
    return msg;
  }

  let tripDate;
  if (data.date) {
    const parts = data.date.split(/[\/\-\.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) tripDate = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      else tripDate = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }
  }
  if (!tripDate) tripDate = new Date().toISOString().split('T')[0];

  const totalExpenses = (data.fuel_cost || 0) + (data.expenses || 0);
  const netProfit = (data.customer_charge || 0) - totalExpenses;

  const result = db.prepare(`
    INSERT INTO trips (truck_id, logged_by, customer_name, origin, destination, distance_km, fuel_litres, fuel_cost, customer_charge, expenses, trip_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(truck.id, user.id, data.customer, data.origin, data.destination, data.distance, data.fuel, data.fuel_cost || 0, data.customer_charge || 0, data.expenses || 0, tripDate, data.notes || null);

  let reply = `Trip logged!\n\nTruck: ${truck.name} (${truck.plate})\nRoute: ${data.origin} > ${data.destination} (${formatNumber(data.distance)} km)\nFuel: ${formatNumber(data.fuel)} L`;
  if (data.fuel_cost) reply += ` | Fuel Cost: ${formatNumber(data.fuel_cost)} Naira`;
  if (data.customer_charge) reply += `\nCharge: ${formatNumber(data.customer_charge)} Naira`;
  if (data.expenses) reply += ` | Expenses: ${formatNumber(data.expenses)} Naira`;
  if (data.customer_charge) reply += `\nNet Profit: ${formatNumber(netProfit)} Naira`;
  reply += `\nCustomer: ${data.customer}\nDate: ${tripDate}\nTrip ID: #${result.lastInsertRowid}`;
  return reply;
}

function handleReport(command, user) {
  let where = '';
  let label = 'This Month';

  if (command.includes('WEEK')) {
    where = "AND trip_date >= date('now', 'weekday 0', '-7 days')";
    label = 'This Week';
  } else if (command.includes('TODAY')) {
    where = "AND trip_date = date('now')";
    label = 'Today';
  } else {
    where = "AND trip_date >= date('now', 'start of month')";
  }

  const stats = db.prepare(`
    SELECT COUNT(*) as trips, COALESCE(SUM(distance_km),0) as km,
      COALESCE(SUM(fuel_litres),0) as fuel, COALESCE(SUM(fuel_cost),0) as cost,
      COALESCE(SUM(customer_charge),0) as revenue, COALESCE(SUM(expenses),0) as expenses
    FROM trips WHERE 1=1 ${where}
  `).get();

  const byTruck = db.prepare(`
    SELECT t.plate, t.name, COUNT(tr.id) as trips, COALESCE(SUM(tr.distance_km),0) as km,
      COALESCE(SUM(tr.fuel_litres),0) as fuel, COALESCE(SUM(tr.customer_charge),0) as revenue,
      COALESCE(SUM(tr.fuel_cost),0) as fuel_cost, COALESCE(SUM(tr.expenses),0) as expenses
    FROM trucks t LEFT JOIN trips tr ON tr.truck_id = t.id ${where ? 'AND' + where.substring(3) : ''}
    WHERE t.active = 1 GROUP BY t.id
  `).all();

  const efficiency = stats.fuel > 0 ? (stats.km / stats.fuel).toFixed(1) : '0';
  const totalExpenses = stats.cost + stats.expenses;
  const netProfit = stats.revenue - totalExpenses;

  let msg = `Fleet Report (${label})\n`;
  msg += `${'─'.repeat(25)}\n`;
  msg += `Trips: ${stats.trips}\n`;
  msg += `Total Distance: ${formatNumber(stats.km)} km\n`;
  msg += `Total Fuel: ${formatNumber(stats.fuel)} L\n`;
  if (stats.cost > 0) msg += `Fuel Cost: ${formatNumber(stats.cost)} Naira\n`;
  if (stats.expenses > 0) msg += `Other Expenses: ${formatNumber(stats.expenses)} Naira\n`;
  msg += `Avg Efficiency: ${efficiency} km/L\n`;
  if (stats.revenue > 0) {
    msg += `\n${'─'.repeat(25)}\n`;
    msg += `Revenue: ${formatNumber(stats.revenue)} Naira\n`;
    msg += `Total Expenses: ${formatNumber(totalExpenses)} Naira\n`;
    msg += `NET PROFIT: ${formatNumber(netProfit)} Naira\n`;
  }

  if (byTruck.length > 0) {
    msg += `\nBy Truck:\n`;
    byTruck.forEach(t => {
      const tNet = t.revenue - t.fuel_cost - t.expenses;
      msg += `${t.name} (${t.plate}): ${t.trips} trips, ${formatNumber(t.km)} km`;
      if (t.revenue > 0) msg += `, Net: ${formatNumber(tNet)} Naira`;
      msg += `\n`;
    });
  }

  return msg;
}

module.exports = { handleMessage };
