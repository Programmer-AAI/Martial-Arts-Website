const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');

// Only migrate gallery.json
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

console.log('Gallery migration complete.');
