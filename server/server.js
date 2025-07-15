const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 3000;
const GALLERY_FILE = path.join(__dirname, 'gallery.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

app.use(express.static('../public'));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());
app.use(cookieParser());

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'gallery-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Load gallery items from file
function loadGallery() {
  try {
    return JSON.parse(fs.readFileSync(GALLERY_FILE, 'utf-8')) || [];
  } catch {
    return [];
  }
}

// Save gallery items to file
function saveGallery(items) {
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(items, null, 2));
}

// Load users from file
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

// Simple in-memory session store
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

// Login route
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });

  const sessionId = Date.now() + '-' + Math.random();
  sessions[sessionId] = { username };
  res.cookie('sessionId', sessionId, { httpOnly: true });
  res.json({ message: 'Logged in' });
});

// Logout route
app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) delete sessions[sessionId];
  res.clearCookie('sessionId');
  res.json({ message: 'Logged out' });
});

// Get all gallery items (public)
app.get('/api/gallery', (req, res) => {
  res.json(loadGallery());
});

// Add new gallery item (admin only)
app.post('/api/gallery', authMiddleware, upload.single('image'), (req, res) => {
  const { title, description, category } = req.body;
  
  if (!title || !description || !category || !req.file) {
    return res.status(400).json({ 
      message: 'Title, description, category, and image are required.' 
    });
  }

  const gallery = loadGallery();
  const imageUrl = '/uploads/' + req.file.filename;
  
  const newItem = { 
    id: Date.now().toString(),
    title,
    description,
    category,
    image: imageUrl,
    date: new Date().toISOString()
  };

  gallery.push(newItem);
  saveGallery(gallery);
  
  res.json({ message: 'Gallery item added successfully!', item: newItem });
});

// Delete gallery item (admin only)
app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
  const gallery = loadGallery();
  const itemId = req.params.id;
  const itemIndex = gallery.findIndex(item => item.id === itemId);

  if (itemIndex === -1) {
    return res.status(404).json({ message: 'Gallery item not found' });
  }

  const [removedItem] = gallery.splice(itemIndex, 1);
  saveGallery(gallery);

  // Delete the associated image file
  const imagePath = path.join(UPLOADS_DIR, path.basename(removedItem.image));
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  res.json({ message: 'Gallery item deleted', item: removedItem });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});