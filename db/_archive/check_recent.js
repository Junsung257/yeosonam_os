const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAll() {
  const { data: pkgs, error } = await sb.from('travel_packages').select('id, title, pkg_code').order('created_at', { ascending: false }).limit(5);
  console.log('Error:', error);
  console.log('Recent 5 Packages:', pkgs);
}
checkAll();
