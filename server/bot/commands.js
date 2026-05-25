const db = require('../db');
const { EXPENSE_CATEGORIES } = require('../db');

function formatNumber(n) {
  return Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function parseLogMessage(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const data = { expenses: {} };
  const catKeys = EXPENSE_CATEGORIES.map(c => c.key);
  const catAliases = {};
  EXPENSE_CATEGORIES.forEach(c => {
    catAliases[c.key] = c.key;
    catAliases[c.label.toLowerCase()] = c.key;
  });
  catAliases['gate'] = 'community_gate';
  catAliases['gate pass'] = 'community_gate';
  catAliases['driver'] = 'driver_motoboy';
  catAliases['motoboy'] = 'driver_motoboy';
  catAliases['wash'] = 'car_wash';
  catAliases['carwash'] = 'car_wash';

  for (const line of lines) {
    const match = line.match(/^(\w[\w\s/]*?):\s*(.+)$/i);
    if (match) {
      const key = match[1].toLowerCase().trim();
      const val = match[2].trim();
      if (key === 'truck') data.truck = val.toUpperCase();
      else if (key === 'date') data.date = val;
      else if (key === 'from') data.origin = val;
      else if (key === 'to') data.destination = val;
      else if (key === 'distance') data.distance = parseFloat(val);
      else if (key === 'fuel') data.fuel = parseFloat(val);
      else if (key === 'customer') data.customer = val;
      else if (key === 'charge' || key === 'price' || key === 'customer charge' || key === 'amount') data.customer_charge = parseFloat(val.replace(/[₦,#]/g, ''));
      else if (key === 'notes' || key === 'note') data.notes = val;
      else if (catAliases[key]) {
        data.expenses[catAliases[key]] = parseFloat(val.replace(/[₦,#]/g, '')) || 0;
      }
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
    let catList = EXPENSE_CATEGORIES.map(c => '  ' + c.label + ': amount').join('\n');
    return 'Fleet Tracker Commands:\n\nLOG\nTruck: PLATE\nDate: DD/MM/YYYY\nFrom: Location\nTo: Location\nDistance: km\nFuel: litres\nCharge: amount charged to customer\nCustomer: Name\n\nExpense fields (all optional):\n' + catList + '\n\nREPORT - This month summary\nREPORT WEEK - This week\nREPORT TODAY - Today only\nTRUCKS - List all trucks\nHELP - Show this message';
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
      msg += '\n' + t.name + ' (' + t.plate + ')\n  ' + t.trips + ' trips | ' + formatNumber(t.km) + ' km\n';
    });
    return msg;
  }

  if (command === 'LOG') {
    if (!['admin', 'staff'].includes(user.role)) {
      return 'You do not have permission to log trips. Contact your admin.';
    }
    return handleLog(text, user);
  }

  return 'Unknown command. Send HELP for available commands.';
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
    return 'Missing fields: ' + missing.join(', ') + '\n\nPlease resend with all fields. Send HELP for the format.';
  }

  const truck = db.prepare('SELECT * FROM trucks WHERE plate = ? AND active = 1').get(data.truck);
  if (!truck) {
    const trucks = db.prepare('SELECT plate, name FROM trucks WHERE active = 1').all();
    let msg = 'Truck "' + data.truck + '" not found.\n\nAvailable trucks:\n';
    trucks.forEach(t => { msg += '  ' + t.plate + ' (' + t.name + ')\n'; });
    return msg;
  }

  let tripDate;
  if (data.date) {
    const parts = data.date.split(/[\/\-\.]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) tripDate = parts[0] + '-' + parts[1].padStart(2,'0') + '-' + parts[2].padStart(2,'0');
      else tripDate = parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
    }
  }
  if (!tripDate) tripDate = new Date().toISOString().split('T')[0];

  const lastTrip = db.prepare('SELECT COALESCE(MAX(trip_number), 0) as max_num FROM trips WHERE truck_id = ? AND trip_date = ?').get(truck.id, tripDate);
  const tripNumber = lastTrip.max_num + 1;

  const result = db.prepare(
    'INSERT INTO trips (truck_id, logged_by, customer_name, origin, destination, distance_km, fuel_litres, customer_charge, trip_date, trip_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(truck.id, user.id, data.customer, data.origin, data.destination, data.distance, data.fuel, data.customer_charge || 0, tripDate, tripNumber, data.notes || null);

  const tripId = result.lastInsertRowid;
  const ins = db.prepare('INSERT INTO trip_expenses (trip_id, category, amount) VALUES (?, ?, ?)');
  let totalExpenses = 0;
  for (const [key, amount] of Object.entries(data.expenses)) {
    if (amount > 0) {
      ins.run(tripId, key, amount);
      totalExpenses += amount;
    }
  }

  const netProfit = (data.customer_charge || 0) - totalExpenses;

  let reply = 'Trip logged!\n\nTruck: ' + truck.name + ' (' + truck.plate + ') - Trip #' + tripNumber + '\nRoute: ' + data.origin + ' > ' + data.destination + ' (' + formatNumber(data.distance) + ' km)\nFuel: ' + formatNumber(data.fuel) + ' L';
  if (data.customer_charge) reply += '\nCharge: ' + formatNumber(data.customer_charge) + ' Naira';
  if (totalExpenses > 0) {
    reply += '\nExpenses: ' + formatNumber(totalExpenses) + ' Naira';
    const catMap = {};
    EXPENSE_CATEGORIES.forEach(c => { catMap[c.key] = c.label; });
    for (const [key, amount] of Object.entries(data.expenses)) {
      if (amount > 0) reply += '\n  ' + (catMap[key] || key) + ': ' + formatNumber(amount);
    }
  }
  if (data.customer_charge) reply += '\nNet Profit: ' + formatNumber(netProfit) + ' Naira';
  reply += '\nCustomer: ' + data.customer + '\nDate: ' + tripDate + '\nTrip ID: #' + tripId;
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

  const stats = db.prepare(
    "SELECT COUNT(*) as trips, COALESCE(SUM(distance_km),0) as km, COALESCE(SUM(fuel_litres),0) as fuel, COALESCE(SUM(customer_charge),0) as revenue FROM trips WHERE 1=1 " + where
  ).get();

  const expTotals = db.prepare(
    "SELECT te.category, COALESCE(SUM(te.amount),0) as total FROM trip_expenses te JOIN trips tr ON tr.id = te.trip_id WHERE 1=1 " + where.replace(/trip_date/g, 'tr.trip_date') + " GROUP BY te.category"
  ).all();

  let totalExpenses = 0;
  const catMap = {};
  EXPENSE_CATEGORIES.forEach(c => { catMap[c.key] = c.label; });
  const expBreakdown = [];
  expTotals.forEach(e => {
    totalExpenses += e.total;
    expBreakdown.push({ label: catMap[e.category] || e.category, total: e.total });
  });

  const netProfit = stats.revenue - totalExpenses;
  const efficiency = stats.fuel > 0 ? (stats.km / stats.fuel).toFixed(1) : '0';

  let msg = 'Fleet Report (' + label + ')\n';
  msg += '─'.repeat(25) + '\n';
  msg += 'Trips: ' + stats.trips + '\n';
  msg += 'Total Distance: ' + formatNumber(stats.km) + ' km\n';
  msg += 'Total Fuel: ' + formatNumber(stats.fuel) + ' L\n';
  msg += 'Avg Efficiency: ' + efficiency + ' km/L\n';

  if (totalExpenses > 0) {
    msg += '\nExpenses Breakdown:\n';
    expBreakdown.forEach(e => {
      msg += '  ' + e.label + ': ' + formatNumber(e.total) + ' Naira\n';
    });
    msg += 'Total Expenses: ' + formatNumber(totalExpenses) + ' Naira\n';
  }

  if (stats.revenue > 0) {
    msg += '\n' + '─'.repeat(25) + '\n';
    msg += 'Revenue: ' + formatNumber(stats.revenue) + ' Naira\n';
    msg += 'NET PROFIT: ' + formatNumber(netProfit) + ' Naira\n';
  }

  const byTruck = db.prepare(
    "SELECT t.plate, t.name, COUNT(tr.id) as trips, COALESCE(SUM(tr.distance_km),0) as km, COALESCE(SUM(tr.customer_charge),0) as revenue FROM trucks t LEFT JOIN trips tr ON tr.truck_id = t.id " + (where ? "AND " + where.substring(3).replace(/trip_date/g, 'tr.trip_date') : '') + " WHERE t.active = 1 GROUP BY t.id"
  ).all();

  if (byTruck.length > 0) {
    msg += '\nBy Truck:\n';
    byTruck.forEach(t => {
      msg += t.name + ' (' + t.plate + '): ' + t.trips + ' trips, ' + formatNumber(t.km) + ' km';
      if (t.revenue > 0) msg += ', Revenue: ' + formatNumber(t.revenue) + ' Naira';
      msg += '\n';
    });
  }

  return msg;
}

module.exports = { handleMessage };
