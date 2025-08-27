const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const cors = require('cors'); // Added CORS support

const app = express();

// Use environment variable for port or default to 3000
const PORT = process.env.PORT || 3000;

// Use path.join for all paths to ensure cross-platform compatibility
const DATA_DIR = path.join(__dirname, 'data');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Create directories if they don't exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(cors({ 
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : 'http://localhost:3000',
  credentials: true 
}));
app.use(express.static('public')); // Serve from same directory
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
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Load gallery items from file with error handling
function loadGallery() {
  try {
    if (fs.existsSync(GALLERY_FILE)) {
      return JSON.parse(fs.readFileSync(GALLERY_FILE, 'utf-8'));
    }
    return [];
  } catch (error) {
    console.error('Error loading gallery:', error);
    return [];
  }
}

// Save gallery items to file with error handling
function saveGallery(items) {
  try {
    fs.writeFileSync(GALLERY_FILE, JSON.stringify(items, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving gallery:', error);
    return false;
  }
}

// Load users from file with error handling
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    }
    return [];
  } catch (error) {
    console.error('Error loading users:', error);
    return [];
  }
}

// Save users to file with error handling
function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving users:', error);
    return false;
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

// User registration endpoint (added for completeness)
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const users = loadUsers();
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    users.push({ username, passwordHash });
    if (!saveUsers(users)) {
      return res.status(500).json({ message: 'Error saving user data' });
    }

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const users = loadUsers();
    const user = users.find(u => u.username === username);
    
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    const sessionId = Date.now() + '-' + Math.random();
    sessions[sessionId] = { username };
    res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'strict' });
    res.json({ message: 'Logged in' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
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
  try {
    res.json(loadGallery());
  } catch (error) {
    console.error('Error getting gallery:', error);
    res.status(500).json({ message: 'Error loading gallery' });
  }
});

// Add new gallery item (admin only)
app.post('/api/gallery', authMiddleware, upload.single('image'), (req, res) => {
  try {
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
    if (!saveGallery(gallery)) {
      return res.status(500).json({ message: 'Error saving gallery data' });
    }
    
    res.json({ message: 'Gallery item added successfully!', item: newItem });
  } catch (error) {
    console.error('Error adding gallery item:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete gallery item (admin only)
app.delete('/api/gallery/:id', authMiddleware, (req, res) => {
  try {
    const gallery = loadGallery();
    const itemId = req.params.id;
    const itemIndex = gallery.findIndex(item => item.id === itemId);

    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Gallery item not found' });
    }

    const [removedItem] = gallery.splice(itemIndex, 1);
    if (!saveGallery(gallery)) {
      return res.status(500).json({ message: 'Error saving gallery data' });
    }

    // Delete the associated image file
    const imagePath = path.join(UPLOADS_DIR, path.basename(removedItem.image));
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res.json({ message: 'Gallery item deleted', item: removedItem });
  } catch (error) {
    console.error('Error deleting gallery item:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
            