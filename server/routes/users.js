const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, name, phone, username, role, created_at FROM users').all();
  res.json(users);
});

router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { name, phone, username, password, role } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'Name, username, password, and role required' });
  }
  if (!['admin', 'staff', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, staff, or viewer' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (name, phone, username, password, role) VALUES (?, ?, ?, ?, ?)').run(name, phone || null, username, hash, role);
    res.json({ id: result.lastInsertRowid, name, username, role });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username or phone already exists' });
    throw e;
  }
});

router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { name, phone, role, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET name=?, phone=?, role=?, password=? WHERE id=?').run(name || user.name, phone !== undefined ? phone : user.phone, role || user.role, hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?, phone=?, role=? WHERE id=?').run(name || user.name, phone !== undefined ? phone : user.phone, role || user.role, req.params.id);
  }
  res.json({ success: true });
});

router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
