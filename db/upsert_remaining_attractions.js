// Usage: node db/upsert_remaining_attractions.js
// Reads attractions_remaining_batch.json and upserts to Supabase directly

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
const env = {};
envFile.split('\n').forEach(l => {
  const [k, ...v] = l.split('=');
  if (k) env[k.trim()] = v.join('=').trim();
});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const items = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'attractions_remaining_batch.json'), 'utf-8')
  );

  console.log(`Loaded ${items.length} items from attractions_remaining_batch.json`);

  // Upsert in batches of 50
  const BATCH = 50;
  let totalUpserted = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const { data, error } = await sb
      .from('attractions')
      .upsert(batch, { onConflict: 'name' });

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} error:`, error.message);
    } else {
      totalUpserted += batch.length;
      console.log(`Batch ${Math.floor(i / BATCH) + 1}: ${batch.length} upserted`);
    }
  }

  console.log(`\nTotal upserted: ${totalUpserted}`);

  // Get total count in DB
  const { count, error: countError } = await sb
    .from('attractions')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Count error:', countError.message);
  } else {
    console.log(`Total attractions in DB: ${count}`);
  }
}

main().catch(console.error);
