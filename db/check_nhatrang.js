const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkPackages() {
  const { data: pkgs } = await sb.from('travel_packages').select('title, pkg_code, itinerary_data').like('title', '%나트랑/달랏%노팁%');
  for (const p of pkgs || []) {
    console.log(`\nTITLE: ${p.title} / CODE: ${p.pkg_code}`);
    for(const d of p.itinerary_data.days) {
      if(d.schedule) {
        d.schedule.forEach(s => {
          if(s.activity.includes('이동')) {
            console.log(`FOUND '이동':`, s);
          }
        });
      }
    }
  }
}
checkPackages();
