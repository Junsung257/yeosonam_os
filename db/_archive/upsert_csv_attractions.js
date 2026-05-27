const {createClient}=require('@supabase/supabase-js');
const fs=require('fs');
const path=require('path');

// Load env
const envFile=fs.readFileSync('.env.local','utf-8');
const env={};
envFile.split('\n').forEach(l=>{const [k,...v]=l.split('=');if(k)env[k.trim()]=v.join('=').trim();});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Read CSV with encoding fix (Latin1 -> UTF-8)
const csvPath = path.join(__dirname, 'attractions_processed.csv');
let rawBytes = fs.readFileSync(csvPath);

// Try to decode: if it's double-encoded UTF-8 (stored as Latin1), convert
let csvText;
try {
  // First try reading as latin1, then re-encode to get proper UTF-8
  const latin1Text = rawBytes.toString('latin1');
  const buf = Buffer.from(latin1Text, 'latin1');
  const utf8Attempt = buf.toString('utf-8');

  // Check if it looks like Korean
  if (utf8Attempt.includes('ì') || utf8Attempt.includes('ë')) {
    // Still garbled - try binary -> utf8 approach
    // The file might be UTF-8 bytes stored incorrectly
    // Try re-interpreting the latin1 bytes as utf-8
    const bytes = [];
    for (let i = 0; i < latin1Text.length; i++) {
      bytes.push(latin1Text.charCodeAt(i));
    }
    csvText = Buffer.from(bytes).toString('utf-8');
  } else {
    csvText = utf8Attempt;
  }
} catch(e) {
  // Fallback: just read as utf-8
  csvText = rawBytes.toString('utf-8');
}

// Remove BOM if present
if (csvText.charCodeAt(0) === 0xFEFF) {
  csvText = csvText.slice(1);
}

// Check if decoding worked
const firstLine = csvText.split('\n')[0];
console.log('First line:', firstLine.substring(0, 100));

if (firstLine.includes('ì') || firstLine.includes('ë')) {
  console.log('\n❌ Encoding still garbled. Trying alternate approach...');

  // Try reading raw bytes and re-interpreting
  const raw = fs.readFileSync(csvPath);
  // Check if it's actually valid UTF-8
  csvText = raw.toString('utf-8');
  if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);

  const fl = csvText.split('\n')[0];
  console.log('Retry first line:', fl.substring(0, 100));

  if (fl.includes('ì') || fl.includes('ë')) {
    console.error('\n❌ Cannot decode CSV file. Please re-save as UTF-8 from Excel.');
    console.error('Excel: File > Save As > CSV UTF-8 (Comma delimited)');
    process.exit(1);
  }
}

console.log('✅ Encoding OK\n');

// Parse CSV with multiline support
function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let fieldIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inQuotes) {
      // Start new row
      currentRow = [];
      currentField = '';
      fieldIndex = 0;
    } else {
      // Continue multiline field
      currentField += '\n';
    }

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];

      if (inQuotes) {
        if (ch === '"') {
          if (j + 1 < line.length && line[j + 1] === '"') {
            currentField += '"';
            j++; // skip escaped quote
          } else {
            inQuotes = false;
          }
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          currentRow.push(currentField.trim());
          currentField = '';
          fieldIndex++;
        } else if (ch === '\r') {
          // skip carriage return
        } else {
          currentField += ch;
        }
      }
    }

    if (!inQuotes) {
      currentRow.push(currentField.trim());
      if (currentRow.length > 1 || currentRow[0] !== '') {
        rows.push(currentRow);
      }
    }
  }

  return rows;
}

const rows = parseCSV(csvText);
const headers = rows[0];
console.log('Headers:', headers);
console.log(`Total data rows: ${rows.length - 1}`);

// Map badge_type to category
function mapBadgeToCategory(badge) {
  const map = {
    'tour': 'sightseeing',
    'special': 'entertainment',
    'shopping': 'shopping',
    'hotel': 'hotel',
    'restaurant': 'restaurant',
    'golf': 'golf',
    'optional': 'sightseeing'
  };
  return map[badge] || 'sightseeing';
}

// Build attraction objects
const attractions = [];
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (row.length < 6) continue;

  const [name, short_desc, long_desc, country, region, badge_type, emoji] = row;

  if (!name || name.trim() === '') continue;

  attractions.push({
    name: name.trim(),
    short_desc: short_desc ? short_desc.trim() : null,
    long_desc: long_desc ? long_desc.trim() : null,
    country: country ? country.trim() : null,
    region: region ? region.trim() : null,
    category: mapBadgeToCategory(badge_type ? badge_type.trim() : 'tour'),
    emoji: emoji ? emoji.trim() : '📍'
  });
}

console.log(`\nParsed ${attractions.length} attractions`);

// Show sample
if (attractions.length > 0) {
  console.log('\nSample entries:');
  for (let i = 0; i < Math.min(3, attractions.length); i++) {
    const a = attractions[i];
    console.log(`  ${i+1}. ${a.name} (${a.country}/${a.region}) - ${a.short_desc}`);
    if (a.long_desc) {
      console.log(`     long_desc: ${a.long_desc.substring(0, 50)}...`);
    }
  }
}

async function main() {
  if (attractions.length === 0) {
    console.error('No attractions parsed!');
    process.exit(1);
  }

  // Upsert in batches of 50
  const BATCH_SIZE = 50;
  let totalUpserted = 0;

  for (let i = 0; i < attractions.length; i += BATCH_SIZE) {
    const batch = attractions.slice(i, i + BATCH_SIZE);

    const {data: result, error} = await sb
      .from('attractions')
      .upsert(batch, {onConflict: 'name'})
      .select('name');

    if (error) {
      console.error(`Batch ${Math.floor(i/BATCH_SIZE)+1} error:`, error);
      // Continue with next batch
      continue;
    }

    totalUpserted += result.length;
    console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}: upserted ${result.length} rows (total: ${totalUpserted})`);
  }

  // Get total count
  const {count, error: countErr} = await sb
    .from('attractions')
    .select('*', {count: 'exact', head: true});

  console.log(`\n✅ Done! Upserted ${totalUpserted} attractions`);
  console.log(`📊 Total attractions in DB: ${count}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
