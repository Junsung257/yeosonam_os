const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let res = 'PKG-';
  for(let i=0; i<6; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

// 2024 year assumption based on typical usage, fallback
function parseDateRange(str) {
  // e.g. "4/1~4/30"
  const parts = str.split('~');
  if(parts.length !== 2) return null;
  const [sm, sd] = parts[0].split('/').map(Number);
  let [em, ed] = parts[1].split('/').map(Number);
  
  if(!em || !ed) return null;
  const year = new Date().getFullYear();
  let start = new Date(year, sm - 1, sd);
  let end = new Date(year, em - 1, ed);
  if(end < start) end.setFullYear(year + 1);
  return { start, end };
}

function expandDates(dateRangesStr, excludedStr) {
  let dates = [];
  const ranges = dateRangesStr.split(',').map(s => s.trim());
  for(const r of ranges) {
    const parsed = parseDateRange(r);
    if(parsed) {
      let curr = new Date(parsed.start);
      while(curr <= parsed.end) {
        dates.push(new Date(curr));
        curr.setDate(curr.getDate() + 1);
      }
    }
  }

  // Handle excluded
  if(excludedStr) {
    let exDates = [];
    const exParts = excludedStr.replace('[', '').replace('제외]', '').replace('제외', '').split(',').map(s => s.trim());
    let currentMonth = null;
    for(let part of exParts) {
      if(part.includes('/')) {
        let [m, dStr] = part.split('/');
        currentMonth = Number(m);
        if(dStr.includes('~')) {
           let [startD, endD] = dStr.split('~').map(Number);
           for(let d=startD; d<=endD; d++) exDates.push(`${currentMonth}-${d}`);
        } else {
           exDates.push(`${currentMonth}-${Number(dStr)}`);
        }
      } else { // no slash, use current month
         if(part.includes('~')) {
           let [startD, endD] = part.split('~').map(Number);
           for(let d=startD; d<=endD; d++) exDates.push(`${currentMonth}-${d}`);
        } else {
           exDates.push(`${currentMonth}-${Number(part)}`);
        }
      }
    }
    dates = dates.filter(d => {
      let m = d.getMonth() + 1;
      let dt = d.getDate();
      return !exDates.includes(`${m}-${dt}`);
    });
  }
  return dates;
}

const pricingLight = [
  { range: '4/1~4/30, 8/8~8/15', exclude: '[4/29~5/2, 8/12~15 제외]', prices: { weekend: 809000, weekday: 859000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '5/1~7/14, 8/30~9/12', exclude: '[5/20~23, 5/30, 6/2~3 제외]', prices: { weekend: 729000, weekday: 779000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/15~7/22, 8/16~8/29, 10/1~10/21', exclude: '[7/15~17, 10/1~3, 10/7~9제외]', prices: { weekend: 779000, weekday: 819000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '7/23~7/29', exclude: '[7/29 제외]', prices: { weekend: 1009000, weekday: 1009000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/30~8/7', exclude: '[7/30~8/1 제외]', prices: { weekend: 969000, weekday: 969000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '9/13~9/30', exclude: '[9/22~25, 9/30 제외]', prices: { weekend: 689000, weekday: 729000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] }
];

const pricingPremium = [
  { range: '4/1~4/30, 8/8~8/15', exclude: '[4/29~5/2, 8/12~15 제외]', prices: { weekend: 879000, weekday: 929000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '5/1~7/14, 8/30~9/12', exclude: '[5/20~23, 5/30, 6/2~3 제외]', prices: { weekend: 799000, weekday: 849000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/15~7/22, 8/16~8/29, 10/1~10/21', exclude: '[7/15~17, 10/1~3, 10/7~9제외]', prices: { weekend: 849000, weekday: 889000 }, weekendDows: [0,1,2,6], weekdayDows: [3,4,5] },
  { range: '7/23~7/29', exclude: '[7/29 제외]', prices: { weekend: 1079000, weekday: 1079000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '7/30~8/7', exclude: '[7/30~8/1 제외]', prices: { weekend: 1039000, weekday: 1039000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] },
  { range: '9/13~9/30', exclude: '[9/22~25, 9/30 제외]', prices: { weekend: 759000, weekday: 799000 }, weekendDows: [0,6], weekdayDows: [1,2,3,4,5] }
];

const specificExlcudedLight = {
  809000: '5/23, 5/30, 6/2',
  879000: '5/20, 6/3, 7/17, 9/30, 10/9',
  999000: '7/15, 7/16, 9/25, 10/3',
  1059000: '4/29, 5/2, 8/1, 8/12, 8/13, 8/15',
  1129000: '7/29, 7/30, 7/31, 10/7',
  1169000: '5/21, 5/22, 8/14, 9/22, 10/1, 10/2, 10/8',
  1299000: '4/30, 9/24',
  1699000: '5/1, 9/23'
};

const specificExlcudedPremium = {
  879000: '5/23, 5/30, 6/2',
  949000: '5/20, 6/3, 7/17, 9/30, 10/9',
  1069000: '7/15, 7/16, 9/25, 10/3',
  1129000: '4/29, 5/2, 8/1, 8/12, 8/13, 8/15',
  1199000: '7/29, 7/30, 7/31, 10/7',
  1239000: '5/21, 5/22, 8/14, 9/22, 10/1, 10/2, 10/8',
  1369000: '4/30, 9/24',
  1769000: '5/1, 9/23'
};

function buildPriceDates(rules, specificMap) {
  const result = [];
  
  // Rule based processing
  for(const r of rules) {
    const dates = expandDates(r.range, r.exclude);
    for(const d of dates) {
       const dow = d.getDay();
       const y = d.getFullYear();
       const mo = String(d.getMonth()+1).padStart(2,'0');
       const da = String(d.getDate()).padStart(2,'0');
       let price = 0;
       if(r.weekendDows.includes(dow)) price = r.prices.weekend;
       else if(r.weekdayDows.includes(dow)) price = r.prices.weekday;
       else price = r.prices.weekday; // fallback

       result.push({ date: `${y}-${mo}-${da}`, price, confirmed: false });
    }
  }

  // Add specific exceptional dates directly
  const year = new Date().getFullYear();
  for(const [priceStr, dateStr] of Object.entries(specificMap)) {
     const p = Number(priceStr);
     const splits = dateStr.split(',').map(s=>s.trim());
     for(const md of splits) {
        let [m, day] = md.split('/').map(Number);
        let y = year;
        const fm = String(m).padStart(2,'0');
        const fd = String(day).padStart(2,'0');
        const dFormatted = `${y}-${fm}-${fd}`;
        // upsert
        const existing = result.find(x => x.date === dFormatted);
        if(existing) {
           existing.price = p; // override
        } else {
           result.push({ date: dFormatted, price: p, confirmed: false });
        }
     }
  }

  result.sort((a,b) => a.date.localeCompare(b.date));
  return result;
}

async function applyPriceDates() {
  const datesLight = buildPriceDates(pricingLight, specificExlcudedLight);
  const datesPremium = buildPriceDates(pricingPremium, specificExlcudedPremium);
  
  const { data: pkgs } = await sb.from('travel_packages').select('*').like('title', '%나트랑/달랏%');
  for(const p of pkgs || []) {
     const isPremium = p.title.includes('품격');
     const pDates = isPremium ? datesPremium : datesLight;
     
     // Remove land operator from title explicitly, put in brand/land_operator_id?
     // We will clear price_tiers and rely entirely on price_dates
     let newTitle = isPremium 
      ? '나트랑/달랏 3박5일 - 전일정 5성급 럭셔리 라달랏 [노팁/노옵션]'
      : '나트랑/달랏 3박5일 - 5성급 호캉스와 특급 힐링 [노팁/노옵션]';

     // code
     let sCode = p.short_code;
     if(!sCode) sCode = generateCode();

     const { error } = await sb.from('travel_packages').update({
       title: newTitle,
       display_title: newTitle,
       short_code: sCode,
       price_dates: pDates,
       price_tiers: [] // Clear broken tiers
     }).eq('id', p.id);

     if(error) console.log('FAILED', error);
     else console.log(`SUCCESS: ${newTitle} - Added ${pDates.length} price dates`);
  }
}

applyPriceDates();
