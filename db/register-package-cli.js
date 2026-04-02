/**
 * 범용 상품 등록 CLI
 *
 * 사용법:
 *   node db/register-package-cli.js <텍스트파일> <랜드사> <커미션%>
 *   node db/register-package-cli.js input.txt 더투어 9
 *
 * 또는 stdin으로:
 *   echo "텍스트..." | node db/register-package-cli.js - 더투어 9
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// env 로드
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 간이 파서 (package-register.ts의 순수 JS 버전) ──

function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function loadNormRules() {
  const { data } = await sb.from('normalization_rules').select('typo_pattern, correct_text, priority').eq('is_active', true).order('priority', { ascending: false });
  return data || [];
}

async function loadExclRules(category) {
  const { data } = await sb.from('exclusion_rules').select('rule_name, match_keywords, severity, description').eq('category', category).eq('is_active', true);
  return data || [];
}

function sanitize(text, rules) {
  let result = text;
  const corrections = [];
  for (const r of rules) {
    if (r.typo_pattern === r.correct_text) continue;
    const re = new RegExp(escapeRegExp(r.typo_pattern), 'g');
    if (re.test(result)) {
      corrections.push({ from: r.typo_pattern, to: r.correct_text });
      result = result.replace(re, r.correct_text);
    }
  }
  return { sanitized: result, corrections };
}

function checkExclusions(text, rules) {
  const warnings = [];
  for (const r of rules) {
    const found = r.match_keywords.some(kw => text.includes(kw));
    if (!found) warnings.push({ rule: r.rule_name, desc: r.description });
  }
  return warnings;
}

async function detectDest(text) {
  const { data } = await sb.from('destination_masters').select('*').eq('is_active', true);
  let best = null;
  for (const d of data || []) {
    let score = 0;
    for (const kw of (d.keywords || [])) { if (text.includes(kw)) score++; }
    if (text.includes(d.name)) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { ...d, score };
  }
  return best;
}

async function matchBlocks(text, destId) {
  const { data } = await sb.from('tour_blocks').select('block_code, name, keywords, quality_score').eq('destination_id', destId).eq('is_active', true);
  const matched = [];
  for (const b of data || []) {
    for (const kw of (b.keywords || [])) {
      if (text.includes(kw) && !matched.find(m => m.code === b.block_code)) {
        matched.push({ code: b.block_code, name: b.name, score: b.quality_score, kw });
        break;
      }
    }
  }
  return matched;
}

function extractPrices(text) {
  const prices = [];
  for (const line of text.split('\n')) {
    const matches = line.match(/(\d{1,3}(?:,\d{3})*(?:,-)?)(?:\s*원|\s*\/인)?/g);
    if (!matches) continue;
    for (const m of matches) {
      let s = m.replace(/[원\/인\s]/g, '');
      if (s.endsWith(',-')) s = s.replace(',-', ',000');
      const n = parseInt(s.replace(/,/g, ''), 10);
      if (n >= 300000 && n <= 5000000 && !prices.includes(n)) prices.push(n);
    }
  }
  return prices;
}

function extractDates(text) {
  const dates = [];
  const year = 2026;
  const patterns = [/(\d{1,2})월\s*(\d{1,2})일/g, /(\d{1,2})\/(\d{1,2})\s*(?:\(|일|월|화|수|목|금|토)/g];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const mo = parseInt(m[1], 10), da = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        const d = `${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
        if (!dates.includes(d)) dates.push(d);
      }
    }
  }
  return dates;
}

function parseDays(text) {
  const days = [];
  const dayPattern = /제(\d)일/g;
  const splits = [];
  let m;
  while ((m = dayPattern.exec(text)) !== null) splits.push({ day: parseInt(m[1], 10), start: m.index });

  for (let i = 0; i < splits.length; i++) {
    const dayText = text.substring(splits[i].start, i + 1 < splits.length ? splits[i + 1].start : text.length);
    const dayNum = splits[i].day;

    const regions = [];
    const rm = dayText.match(/(?:부\s*산|장가계|나트랑|달\s*랏|판\s*랑)/g);
    if (rm) for (const r of rm) { const c = r.replace(/\s/g, ''); if (!regions.includes(c)) regions.push(c); }

    const meals = {};
    const bm = dayText.match(/조:([^\n]+)/); if (bm) { const v = bm[1].trim(); meals.breakfast = v !== '불포함'; if (meals.breakfast) meals.breakfast_note = v; }
    const lm = dayText.match(/중:([^\n]+)/); if (lm) { const v = lm[1].trim(); meals.lunch = v !== '불포함'; if (meals.lunch) meals.lunch_note = v; }
    const dm = dayText.match(/석:([^\n]+)/); if (dm) { const v = dm[1].trim(); meals.dinner = v !== '불포함'; if (meals.dinner) meals.dinner_note = v; }

    const schedule = [];
    for (const line of dayText.split('\n')) {
      const t = line.trim();
      if (!t || /^(제|HOTEL|조:|중:|석:|날|지\s*역|교통|시\s*간|주\s*요|식\s*사)/.test(t)) continue;
      const fm = t.match(/(BX\d+|7C\d+)/);
      const tm = t.match(/^(\d{2}:\d{2})/);
      if (fm) schedule.push({ time: tm?.[1] || null, activity: t, type: 'flight', transport: fm[1] });
      else if (t.startsWith('▶') || t.startsWith('-') || t.length > 5) schedule.push({ time: tm?.[1] || null, activity: t, type: 'normal' });
    }

    let hotel = null;
    const hm = dayText.match(/HOTEL:\s*(.+?)(?:\n|$)/);
    if (hm) {
      const hs = hm[1].trim();
      const gm = hs.match(/([준정특]?\d성|5성급)/);
      hotel = { name: hs.replace(/\(.*\)/, '').trim(), grade: gm?.[1] || '4', note: hs.includes('동급') ? '또는 동급' : '' };
    }

    days.push({ day: dayNum, regions, meals, schedule, hotel });
  }
  return days;
}

function extractMeta(text) {
  const dm = text.match(/(\d)박(\d)일/);
  const nights = dm ? parseInt(dm[1], 10) : 3;
  const duration = dm ? parseInt(dm[2], 10) : 4;
  const isGolf = /골프|CC|라운딩/i.test(text);

  const types = [];
  if (/실속/.test(text)) types.push('실속');
  if (/품격/.test(text)) types.push('품격');
  if (/노옵션/.test(text)) types.push('노옵션');
  if (/노팁/.test(text)) types.push('노팁');
  if (/노쇼핑/.test(text)) types.push('노쇼핑');
  if (/특가/.test(text)) types.push('특가');

  const minM = text.match(/(\d+)명\s*이상/);

  const inclM = text.match(/포\s*함[^:\n]*[:：]\s*([^\n]+)/);
  const exclM = text.match(/불\s*포\s*함[^:\n]*[:：]\s*([^\n]+)/);
  const accomM = text.match(/HOTEL:\s*(.+?)(?:\n|$)/);

  const tags = [...types];
  if (/마사지/.test(text)) tags.push('마사지');
  if (/리무진/.test(text)) tags.push('리무진');
  if (/VIP/.test(text)) tags.push('VIP');
  if (/대협곡/.test(text)) tags.push('대협곡');
  if (/야경/.test(text)) tags.push('야경');

  return {
    nights, duration,
    category: isGolf ? '골프' : '패키지',
    tripStyle: isGolf ? '골프' : '관광',
    productType: types.join('|') || '패키지',
    minParticipants: minM ? parseInt(minM[1], 10) : 4,
    inclusions: inclM ? inclM[1].split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
    excludes: exclM ? exclM[1].split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
    accommodations: accomM ? [accomM[1].trim()] : [],
    tags,
  };
}

// ── 메인 ──

async function run() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('사용법: node db/register-package-cli.js <텍스트파일> <랜드사> <커미션%>');
    console.log('예시:   node db/register-package-cli.js input.txt 더투어 9');
    process.exit(1);
  }

  const [file, landOp, commStr] = args;
  const commission = parseFloat(commStr);

  let rawText;
  if (file === '-') {
    rawText = fs.readFileSync(0, 'utf-8');
  } else {
    rawText = fs.readFileSync(file, 'utf-8');
  }

  console.log(`\n🚀 상품 등록 시작: 랜드사=${landOp}, 커미션=${commission}%\n`);

  // Step 1: 정제
  const normRules = await loadNormRules();
  const { sanitized, corrections } = sanitize(rawText, normRules);
  if (corrections.length > 0) {
    console.log(`📝 오타 교정 ${corrections.length}건:`);
    for (const c of corrections) console.log(`   "${c.from}" → "${c.to}"`);
  }

  // Step 2: 지역 감지
  const dest = await detectDest(sanitized);
  if (!dest) { console.error('❌ 지역을 감지할 수 없습니다.'); process.exit(1); }
  console.log(`🌍 지역: ${dest.name} (${dest.country})`);

  // Step 3: 블록 매칭
  const blocks = await matchBlocks(sanitized, dest.id);
  console.log(`📦 블록 매칭: ${blocks.length}개`);
  for (const b of blocks) console.log(`   ${b.code}: ${b.name} (${b.score}점) [${b.kw}]`);
  const totalScore = blocks.reduce((s, b) => s + (b.score || 0), 0);
  console.log(`   📊 총 품질점수: ${totalScore}`);

  // Step 4: 가격 + 출발일
  const prices = extractPrices(sanitized);
  const dates = extractDates(sanitized);
  console.log(`💰 가격: ${prices.map(p => p.toLocaleString() + '원').join(', ') || '감지 실패'}`);
  console.log(`📅 출발일: ${dates.join(', ') || '감지 실패'}`);

  // Step 5: 메타데이터
  const meta = extractMeta(sanitized);
  console.log(`📋 ${meta.nights}박${meta.duration}일 | ${meta.category} | ${meta.productType}`);

  // Step 6: 불포함 가드레일
  const exclCat = meta.category.includes('골프') ? 'golf' : 'tour';
  const exclRules = await loadExclRules(exclCat);
  const fullText = [sanitized, meta.excludes.join(' '), meta.inclusions.join(' ')].join(' ');
  const warnings = checkExclusions(fullText, exclRules);
  if (warnings.length > 0) {
    console.log(`⚠️  가드레일 경고 ${warnings.length}건:`);
    for (const w of warnings) console.log(`   ${w.rule}: ${w.desc}`);
  }

  // Step 7: 일정 파싱
  const daySchedules = parseDays(sanitized);
  console.log(`📆 일정: ${daySchedules.length}일 파싱 완료`);

  // Step 8: price_tiers 구성
  const priceTiers = prices.length === 1 && dates.length > 0
    ? [{ period_label: dates.map(d => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; }).join(', '), departure_dates: dates, adult_price: prices[0], status: 'available' }]
    : prices.map((p, i) => ({ period_label: `가격 ${i+1}`, adult_price: p, status: 'available' }));

  // Step 9: 타이틀
  const tagStr = meta.tags.map(t => `#${t}`).join(' ');
  const titleBase = sanitized.split('\n').find(l => /PKG|박\d일|장가계|나트랑/.test(l))?.trim().substring(0, 60) || dest.name;
  const title = `${titleBase} ${tagStr}`.trim().substring(0, 200);

  const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const summary = `${dest.name} ${meta.nights}박${meta.duration}일. ${lowestPrice > 0 ? lowestPrice.toLocaleString() + '원.' : ''} ${meta.tags.join(', ')}.`;

  // Step 10: INSERT
  console.log(`\n━━━ 등록 데이터 ━━━`);
  console.log(`  제목: ${title}`);
  console.log(`  가격: ${lowestPrice.toLocaleString()}원`);
  console.log(`  랜드: ${landOp} ${commission}%`);

  const { data, error } = await sb.from('travel_packages').insert([{
    title,
    destination: dest.name,
    category: meta.category,
    product_type: meta.productType,
    trip_style: meta.tripStyle,
    departure_airport: dest.default_departure_airport || '김해공항',
    airline: dest.default_airline || 'BX',
    min_participants: meta.minParticipants,
    status: 'approved',
    country: dest.country,
    duration: meta.duration,
    nights: meta.nights,
    price: lowestPrice,
    land_operator: landOp,
    commission_rate: commission,
    product_summary: summary,
    product_tags: meta.tags,
    product_highlights: meta.tags.slice(0, 5),
    price_tiers: priceTiers,
    inclusions: meta.inclusions,
    excludes: meta.excludes,
    accommodations: meta.accommodations,
    special_notes: '',
    itinerary_data: {
      meta: { title, destination: dest.name, nights: meta.nights, days: meta.duration, airline: dest.default_airline, flight_out: dest.default_flight_out, flight_in: dest.default_flight_in, departure_airport: dest.default_departure_airport },
      days: daySchedules,
    },
    raw_text: rawText,
    filename: `auto-${landOp}-${dest.name}-${Date.now()}`,
    file_type: 'manual',
    confidence: 0.9,
  }]).select('id, title');

  if (error) {
    console.error(`\n❌ 등록 실패:`, error.message);
  } else {
    console.log(`\n✅ 등록 완료: ${data[0].title}`);
    console.log(`   ID: ${data[0].id}`);
  }
}

run().catch(console.error);
