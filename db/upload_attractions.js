// Usage: node db/upload_attractions.js
// Reads both JSON files and uploads to /api/attractions via PUT (upsert)

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  // Load both files
  const file1 = path.join(__dirname, 'attractions_modetour_batch.json');
  const file2 = path.join(__dirname, 'attractions_thailand_batch.json');

  let items = JSON.parse(fs.readFileSync(file1, 'utf-8'));

  if (fs.existsSync(file2)) {
    const items2 = JSON.parse(fs.readFileSync(file2, 'utf-8'));
    items = items.concat(items2);
  }

  // Deduplicate by name
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!seen.has(item.name)) {
      seen.add(item.name);
      unique.push(item);
    }
  }

  console.log(`Total items: ${unique.length} (deduplicated from ${items.length})`);

  // Upload in batches of 50
  const BATCH = 50;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const res = await fetch(`${BASE_URL}/api/attractions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: batch }),
    });
    const data = await res.json();
    console.log(`Batch ${Math.floor(i/BATCH)+1}: ${data.upserted || 0} upserted`);
  }

  console.log('Done!');
}

main().catch(console.error);
