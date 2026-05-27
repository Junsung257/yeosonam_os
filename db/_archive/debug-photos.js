const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function isLegacyFormat(photo) {
  if (!photo || typeof photo !== 'object') return false;
  const hasNew = 'src_medium' in photo || 'src_large' in photo;
  const hasLegacy = 'url' in photo || 'thumb' in photo;
  return !hasNew && hasLegacy;
}

(async () => {
  const { count } = await sb.from('attractions').select('id', { count: 'exact', head: true });
  console.log('Total attractions:', count);
  let legacyCount = 0, mixedCount = 0, newCount = 0, emptyCount = 0, offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb.from('attractions').select('id, name, photos').not('photos', 'is', null).range(offset, offset + PAGE - 1);
    if (error) { console.error(error); return; }
    if (!data || data.length === 0) break;
    for (const a of data) {
      if (!Array.isArray(a.photos) || a.photos.length === 0) { emptyCount++; continue; }
      const firstPhoto = a.photos[0];
      if (isLegacyFormat(firstPhoto)) { legacyCount++; if (legacyCount <= 5) console.log(`LEGACY: ${a.name}`); }
      else if (firstPhoto && ('src_medium' in firstPhoto || 'src_large' in firstPhoto)) newCount++;
      else mixedCount++;
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`\nFinal: legacy=${legacyCount} new=${newCount} other=${mixedCount} empty=${emptyCount}`);
})();
