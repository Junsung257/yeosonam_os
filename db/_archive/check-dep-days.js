const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RE = /^(매일|[월화수목금토일](?:[\/,\s][월화수목금토일])*|매주\s*[월화수목금토일][월화수목금토일\/요일,\s]*)$/;
(async () => {
  const { data } = await sb.from('travel_packages').select('departure_days').not('departure_days', 'is', null);
  const counts = {};
  for (const p of data) {
    const dd = String(p.departure_days).trim();
    if (!RE.test(dd)) counts[dd] = (counts[dd] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`실패 패턴 ${sorted.length}종:`);
  for (const [v, c] of sorted.slice(0, 30)) console.log(`  ${c}x — ${JSON.stringify(v)}`);
})().catch(e => { console.error(e); process.exit(1); });
