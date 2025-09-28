// setup.js
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');

// --- 1. Add admin user if missing ---
const adminHash = '$2a$12$c.et4NRFL.1QhQzPyYfIueNeSNjHF/vf4wcObUlnTReRHnaeI.WgK';
const adminUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');

if (!adminUser) {
  db.prepare('INSERT INTO users (username, passwordHash) VALUES (?, ?)').run(
    'admin',
    adminHash
  );
  console.log('Admin user added.');
} else {
  console.log('Admin user already exists.');
}

// --- 2. Migrate gallery.json ---
const galleryFile = path.join(DATA_DIR, 'gallery.json');
if (fs.existsSync(galleryFile)) {
  const gallery = JSON.parse(fs.readFileSync(galleryFile, 'utf-8'));
  gallery.forEach(item => {
    const exists = db.prepare('SELECT * FROM gallery WHERE id = ?').get(item.id);
    if (!exists) {
      db.prepare(`
        INSERT INTO gallery (id, title, description, category, image, date)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.title,
        item.description,
        item.category,
        item.image,
        item.date
      );
      console.log(`Gallery item "${item.title}" added.`);
    }
  });
}

console.log('Setup complete. You can now run server.js and login as admin.');
