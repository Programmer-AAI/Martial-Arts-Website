// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const db = require('./db'); // Import SQLite database

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static('public'));

// In-memory session store
const sessions = {};

// Authentication middleware
function authMiddleware(req, res, next) {
  const sessionId = req.cookies.sessionId;
  if (sessionId && sessions[sessionId]) {
    req.user = sessions[sessionId];
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
}

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'gallery-' + unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ----------------- Auth Routes -----------------

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });

  const sessionId = Date.now() + '-' + Math.random();
  sessions[sessionId] = { username };

  res.cookie('sessionId', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  });

  res.json({ message: 'Logged in' });
});

// Logout
app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) delete sessions[sessionId];
  res.clearCookie('sessionId');
  res.json({ message: 'Logged out' });
});

// ----------------- Gallery Routes -----------------

// Get all gallery items (public)
app.get('/api/gallery', (req, res) => {
  const gallery = db.prepare('SELECT * FROM gallery ORDER BY date DESC').all();
  res.json(gallery);
});

// Add gallery item (admin)
app.post('/api/gallery', authMiddleware, upload.single('image'), (req, res) => {
  const { title, description, category } = req.body;
  if (!title || !description || !category || !req.file)
    return res.status(400).json({ message: 'All fields including image are required' });

  const imagePath = '/uploads/' + req.file.filename;

  const info = db.prepare(`
    INSERT INTO gallery (title, description, category, image, date)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description, category, imagePath, new Date().toISOString());

  const newItem = db.prepare('SELECT * FROM gallery WHERE id = ?').get(info.lastInsertRowid);

  res.json({ message: 'Gallery item added', item: newItem });
});

// Delete gallery item (admin)
app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const item = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ message: 'Item not found' });

  db.prepare('DELETE FROM gallery WHERE id = ?').run(id);

  // Delete image file
  const imgPath = path.join(UPLOADS_DIR, path.basename(item.image));
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

  res.json({ message: 'Gallery item deleted', item });
});

// ----------------- Health & Fallback -----------------

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
