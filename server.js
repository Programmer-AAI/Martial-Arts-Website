// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

// JSON file helpers
function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('Error reading file', filePath, err);
    return [];
  }
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving file', filePath, err);
    return false;
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

  const users = loadJSON(USERS_FILE);
  const user = users.find(u => u.username === username);
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
  res.json(loadJSON(GALLERY_FILE));
});

// Add gallery item (admin)
app.post('/api/gallery', authMiddleware, upload.single('image'), (req, res) => {
  const { title, description, category } = req.body;
  if (!title || !description || !category || !req.file)
    return res.status(400).json({ message: 'All fields including image are required' });

  const gallery = loadJSON(GALLERY_FILE);
  const newItem = {
    id: Date.now().toString(),
    title,
    description,
    category,
    image: '/uploads/' + req.file.filename,
    date: new Date().toISOString()
  };

  gallery.push(newItem);
  if (!saveJSON(GALLERY_FILE, gallery))
    return res.status(500).json({ message: 'Error saving gallery' });

  res.json({ message: 'Gallery item added', item: newItem });
});

// Delete gallery item (admin)
app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
  const gallery = loadJSON(GALLERY_FILE);
  const itemId = req.params.id;
  const index = gallery.findIndex(i => i.id === itemId);
  if (index === -1) return res.status(404).json({ message: 'Item not found' });

  const [removed] = gallery.splice(index, 1);
  if (!saveJSON(GALLERY_FILE, gallery))
    return res.status(500).json({ message: 'Error saving gallery' });

  // Delete image file
  const imgPath = path.join(UPLOADS_DIR, path.basename(removed.image));
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

  res.json({ message: 'Gallery item deleted', item: removed });
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
