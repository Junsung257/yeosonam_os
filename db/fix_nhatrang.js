const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function fixPackages() {
  console.log('Fetching Nha Trang packages to fix...');
  const { data: pkgs } = await sb.from('travel_packages').select('*').like('title', '%나트랑/달랏%노팁%');
  if (!pkgs || pkgs.length === 0) {
    console.log('No packages found'); return;
  }

  for (const p of pkgs) {
    const isPremium = p.title.includes('품격');
    
    // 1. Fix Title
    const newTitle = isPremium 
      ? '나트랑/달랏 3박5일 - 전일정 5성급 럭셔리 라달랏 [노팁/노옵션]' 
      : '나트랑/달랏 3박5일 - 5성급 호캉스와 특급 힐링 [노팁/노옵션]';

    // 2. Fix Price Tiers date format (e.g. "5/1~7/14" -> "05/01~07/14")
    let newPriceTiers = p.price_tiers;
    if (newPriceTiers) {
      newPriceTiers = newPriceTiers.map(t => {
        if(t.period_label) {
          t.period_label = t.period_label.split('~').map(d => {
            let [m, day] = d.split('/');
            if(m && day) return `${m.padStart(2,'0')}/${day.padStart(2,'0')}`;
            return d;
          }).join('~');
        }
        return t;
      });
    }

    // 3. Fix Schedule
    let newItinerary = p.itinerary_data;
    if (newItinerary && newItinerary.days) {
      newItinerary.days = newItinerary.days.map(d => {
        if (d.schedule) {
          d.schedule = d.schedule.filter(s => {
             // Remove purely transitional activities from normal flow
             if (s.type === 'normal' && (
                s.activity.includes('이동') || 
                s.activity.includes('투숙 및 휴식') || 
                s.activity.includes('호텔 체크인') ||
                s.activity.includes('쇼핑센터 방문')
             )) {
               console.log(`Filtering out node: ${s.activity}`);
               return false;
             }
             return true;
          });
        }
        return d;
      });
    }

    const { error } = await sb.from('travel_packages').update({
      title: newTitle,
      display_title: newTitle,
      price_tiers: newPriceTiers,
      itinerary_data: newItinerary
    }).eq('id', p.id);
    
    if (error) {
      console.error(`Failed to update ${p.title}:`, error);
    } else {
      console.log(`Successfully Updated: ${newTitle}`);
    }
  }
}

fixPackages();
