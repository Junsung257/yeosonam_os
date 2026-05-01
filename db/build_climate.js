/**
 * destination_climate 빌드 스크립트
 *
 * 1. DESTINATION_SEED — 우리 패키지에 등장하는 destination string들의 좌표·대표도시 수동 매핑
 *    (멀티시티는 첫 도시 또는 사장님 결정 도시)
 * 2. tz-lookup → IANA timezone 자동 추출
 * 3. Open-Meteo Historical API → 30년 normals (1995~2024)
 * 4. travel-fitness-score → 12개월 점수 계산
 * 5. destination_climate UPSERT
 *
 * 실행:
 *   node db/build_climate.js              # 신규/갱신 destination만
 *   node db/build_climate.js --force      # 전체 재빌드
 *   node db/build_climate.js --dest 다낭/호이안   # 특정 destination만
 *   node db/build_climate.js --dry        # DB 쓰기 없이 미리보기
 */
const fs = require('fs');
const tzLookup = require('tz-lookup');
const { createClient } = require('@supabase/supabase-js');

// fitness 산식은 TS 파일이라 require 못씀 — 같은 산식을 여기에 미러링
// (TS lib과 동일한 가중치 / 함수 — 변경 시 양쪽 동기화 필요)
function tempComfort(t) {
  if (t >= 18 && t <= 28) return 100;
  if (t < 18) return Math.max(0, 100 - (18 - t) * 5);
  return Math.max(0, 100 - (t - 28) * 7);
}
function rainPenalty(d) { return Math.max(0, Math.min(100, 100 - (d / 15) * 100)); }
function humidityPenalty(h) {
  if (h >= 50 && h <= 70) return 100;
  if (h < 50) return Math.max(0, 100 - (50 - h) * 2.5);
  return Math.max(0, 100 - (h - 70) * 3);
}
function crowdInverse(m) {
  const peak = { 1:8, 2:5, 3:5, 4:6, 5:7, 6:5, 7:9, 8:9, 9:5, 10:7, 11:4, 12:8 };
  return 60 + (10 - (peak[m] ?? 5)) * 4;
}
function computeFitness(m) {
  const t = tempComfort(m.temp_mean);
  const r = rainPenalty(m.rain_days);
  const h = humidityPenalty(m.humidity);
  const c = crowdInverse(m.month);
  const score = Math.round(0.40*t + 0.35*r + 0.10*h + 0.15*c);
  const label = score >= 85 ? '매우 좋음' : score >= 70 ? '좋음' : score >= 55 ? '보통' : score >= 40 ? '주의' : '피하세요';
  const axes = [
    { s: t, msg: m.temp_mean > 30 ? '무더위 ☀️' : m.temp_mean < 10 ? '추위 🥶' : null },
    { s: r, msg: m.rain_days >= 12 ? '우기 ☔' : m.rain_days >= 8 ? '비 자주' : null },
    { s: h, msg: m.humidity >= 80 ? '고습도 💧' : null },
    { s: c, msg: c <= 70 ? '성수기 (가격↑)' : null },
  ];
  const worst = axes.reduce((a, b) => a.s < b.s ? a : b);
  return { month: m.month, score, label, key_concern: score < 75 && worst.msg ? worst.msg : null };
}

// ─── DESTINATION 시드 ──────────────────────────────────────────────
// 좌표는 대표도시 시청 좌표 기준. 멀티시티 표기 변형(슬래시·콤마·공백)은
// 같은 좌표를 공유하도록 별도 row로 등록.
const DESTINATION_SEED = [
  // ── 중국 ──
  { destination: '장가계',                primary_city: '장가계',     country: '중국',  lat: 29.1170, lon: 110.4793 },
  { destination: '칭다오',                primary_city: '칭다오',     country: '중국',  lat: 36.0671, lon: 120.3826 },
  { destination: '청도',                  primary_city: '칭다오',     country: '중국',  lat: 36.0671, lon: 120.3826 },
  { destination: '서안',                  primary_city: '서안',       country: '중국',  lat: 34.3416, lon: 108.9398 },
  { destination: '서안/구채구',           primary_city: '서안',       country: '중국',  lat: 34.3416, lon: 108.9398 },
  { destination: '서안/칠채산',           primary_city: '서안',       country: '중국',  lat: 34.3416, lon: 108.9398 },
  { destination: '석가장',                primary_city: '석가장',     country: '중국',  lat: 38.0428, lon: 114.5149 },
  { destination: '석가장 태항산',         primary_city: '석가장',     country: '중국',  lat: 38.0428, lon: 114.5149 },
  { destination: 'Tianjin, China',        primary_city: '천진',       country: '중국',  lat: 39.3434, lon: 117.3616 },
  { destination: '천진',                  primary_city: '천진',       country: '중국',  lat: 39.3434, lon: 117.3616 },
  { destination: '북경',                  primary_city: '베이징',     country: '중국',  lat: 39.9042, lon: 116.4074 },
  { destination: '북경/고북수진',         primary_city: '베이징',     country: '중국',  lat: 39.9042, lon: 116.4074 },
  { destination: '북경/만리장성',         primary_city: '베이징',     country: '중국',  lat: 39.9042, lon: 116.4074 },
  { destination: '구채구, 신선지',        primary_city: '구채구',     country: '중국',  lat: 33.2658, lon: 103.9244 },
  { destination: '란주, 황하석림, 바단지린, 칠채산', primary_city: '란주', country: '중국', lat: 36.0611, lon: 103.8343 },
  { destination: '황산',                  primary_city: '황산',       country: '중국',  lat: 30.1340, lon: 118.1660 },
  { destination: '티벳',                  primary_city: '라싸',       country: '중국',  lat: 29.6520, lon: 91.1721 },
  { destination: '호화호특',              primary_city: '호화호특',   country: '중국',  lat: 40.8419, lon: 111.7497 },

  // ── 일본 ──
  { destination: '시즈오카',              primary_city: '시즈오카',   country: '일본',  lat: 34.9756, lon: 138.3828 },
  { destination: '시즈오카 카와구치 이즈반도', primary_city: '시즈오카', country: '일본', lat: 34.9756, lon: 138.3828 },
  { destination: '나가사키',              primary_city: '나가사키',   country: '일본',  lat: 32.7448, lon: 129.8736 },
  { destination: '북해도',                primary_city: '삿포로',     country: '일본',  lat: 43.0642, lon: 141.3469 },
  { destination: '북해도 비에이ᆞ오타루ᆞ도야ᆞ노보리베츠', primary_city: '삿포로', country: '일본', lat: 43.0642, lon: 141.3469 },
  { destination: '후쿠오카',              primary_city: '후쿠오카',   country: '일본',  lat: 33.5904, lon: 130.4017 },
  { destination: '오사카',                primary_city: '오사카',     country: '일본',  lat: 34.6937, lon: 135.5023 },
  { destination: '오키나와',              primary_city: '나하',       country: '일본',  lat: 26.2124, lon: 127.6809 },

  // ── 베트남 ──
  { destination: '나트랑',                primary_city: '나트랑',     country: '베트남', lat: 12.2388, lon: 109.1967 },
  { destination: '나트랑/달랏',           primary_city: '나트랑',     country: '베트남', lat: 12.2388, lon: 109.1967 },
  { destination: '나트랑/판랑',           primary_city: '나트랑',     country: '베트남', lat: 12.2388, lon: 109.1967 },
  { destination: '다낭/호이안',           primary_city: '다낭',       country: '베트남', lat: 16.0544, lon: 108.2022 },
  { destination: '다낭, 호이안',          primary_city: '다낭',       country: '베트남', lat: 16.0544, lon: 108.2022 },
  { destination: '다낭 호이안',           primary_city: '다낭',       country: '베트남', lat: 16.0544, lon: 108.2022 },
  { destination: '하노이/하롱베이',       primary_city: '하노이',     country: '베트남', lat: 21.0285, lon: 105.8542 },
  { destination: '푸꾸옥',                primary_city: '푸꾸옥',     country: '베트남', lat: 10.2899, lon: 103.9840 },
  { destination: '호치민',                primary_city: '호치민',     country: '베트남', lat: 10.8231, lon: 106.6297 },

  // ── 필리핀 ──
  { destination: '보홀',                  primary_city: '보홀',       country: '필리핀', lat:  9.6502, lon: 123.8703 },
  { destination: '세부',                  primary_city: '세부',       country: '필리핀', lat: 10.3157, lon: 123.8854 },

  // ── 태국 ──
  { destination: '치앙마이',              primary_city: '치앙마이',   country: '태국',  lat: 18.7883, lon:  98.9853 },
  { destination: '치앙마이, 치앙라이',    primary_city: '치앙마이',   country: '태국',  lat: 18.7883, lon:  98.9853 },

  // ── 라오스 ──
  { destination: '라오스',                primary_city: '비엔티엔',   country: '라오스', lat: 17.9757, lon: 102.6331 },
  { destination: '비엔티안/방비엥',       primary_city: '비엔티엔',   country: '라오스', lat: 17.9757, lon: 102.6331 },
  { destination: '비엔티안/루앙프라방/방비엥', primary_city: '비엔티엔', country: '라오스', lat: 17.9757, lon: 102.6331 },
  { destination: '비엔티엔/루앙프라방/방비엥', primary_city: '비엔티엔', country: '라오스', lat: 17.9757, lon: 102.6331 },
  { destination: '라오스 (비엔티엔, 루앙프라방, 방비엥)', primary_city: '비엔티엔', country: '라오스', lat: 17.9757, lon: 102.6331 },
  { destination: '라오스 (비엔티엔, 방비엥)', primary_city: '비엔티엔', country: '라오스', lat: 17.9757, lon: 102.6331 },
  { destination: '라오스, 태국 우돈타니', primary_city: '비엔티엔',   country: '라오스', lat: 17.9757, lon: 102.6331 },

  // ── 몽골 ──
  { destination: '울란바토르, 테를지',    primary_city: '울란바토르', country: '몽골',  lat: 47.8864, lon: 106.9057 },
  { destination: '울란바토르, 테를지, 엘승타사르',  primary_city: '울란바토르', country: '몽골', lat: 47.8864, lon: 106.9057 },
  { destination: '울란바토르, 테를지, 엘승타사르해', primary_city: '울란바토르', country: '몽골', lat: 47.8864, lon: 106.9057 },

  // ── 인도네시아 ──
  { destination: '발리',                  primary_city: '덴파사르',   country: '인도네시아', lat: -8.6500, lon: 115.2167 },

  // ── 말레이시아 / 싱가포르 ──
  { destination: '쿠알라룸푸르/싱가포르/말라카', primary_city: '쿠알라룸푸르', country: '말레이시아', lat: 3.1390, lon: 101.6869 },

  // ── 홍콩 / 마카오 / 대만 ──
  { destination: '마카오',                primary_city: '마카오',     country: '마카오', lat: 22.1987, lon: 113.5439 },
  { destination: '마카오, 홍콩',          primary_city: '마카오',     country: '마카오', lat: 22.1987, lon: 113.5439 },
  { destination: '마카오/홍콩',           primary_city: '마카오',     country: '마카오', lat: 22.1987, lon: 113.5439 },
  { destination: '타이페이',              primary_city: '타이페이',   country: '대만',  lat: 25.0330, lon: 121.5654 },
];

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');
const destFilterIdx = args.indexOf('--dest');
const destFilter = destFilterIdx >= 0 ? args[destFilterIdx + 1] : null;

const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const KST_OFFSET_MIN = 9 * 60; // KST = UTC+9

/** IANA TZ → KST 대비 분 단위 차이 (음수 = 한국보다 늦음) */
function getOffsetMinutes(timezone) {
  // 현재 시점 기준 (DST 가 있는 곳은 정확도 ±60min 변동)
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now);
  const parts = Object.fromEntries(local.map(p => [p.type, p.value]));
  const localTime = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const utcTime = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes());
  const tzOffsetMin = Math.round((localTime - utcTime) / 60000);
  return tzOffsetMin - KST_OFFSET_MIN;
}

/** Open-Meteo Historical API — 일별 → 월별 평균/합계 → normals 12개월
 *  자동 backoff: 429 받으면 60초 대기 후 재시도 (최대 4회) */
async function fetchNormals(lat, lon, attempt = 1) {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('start_date', '2014-01-01'); // 10년치 (rate limit 회피, normals 충분)
  url.searchParams.set('end_date',   '2024-12-31');
  url.searchParams.set('daily', [
    'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
    'precipitation_sum',
    'relative_humidity_2m_mean',
  ].join(','));
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url.toString());
  if (res.status === 429) {
    if (attempt > 4) throw new Error('Open-Meteo 429 — 4회 재시도 후 포기');
    console.log(`   ⏳ 429 — 60초 대기 후 재시도 (${attempt}/4)`);
    await new Promise(r => setTimeout(r, 60000));
    return fetchNormals(lat, lon, attempt + 1);
  }
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const d = data.daily;
  if (!d || !d.time) throw new Error('Open-Meteo daily payload empty');

  // 월별 집계
  const buckets = Array.from({ length: 12 }, () => ({
    days: 0, tmax_sum: 0, tmin_sum: 0, tmean_sum: 0,
    precip_sum: 0, rain_sum: 0, hum_sum: 0, rain_days: 0, year_count: new Set(),
  }));
  for (let i = 0; i < d.time.length; i++) {
    const date = d.time[i];
    const month = Number(date.slice(5, 7));
    const year = Number(date.slice(0, 4));
    const b = buckets[month - 1];
    b.days++;
    b.year_count.add(year);
    b.tmax_sum  += d.temperature_2m_max[i] ?? 0;
    b.tmin_sum  += d.temperature_2m_min[i] ?? 0;
    b.tmean_sum += d.temperature_2m_mean[i] ?? 0;
    b.precip_sum += d.precipitation_sum[i] ?? 0;
    b.rain_sum   += d.rain_sum?.[i] ?? d.precipitation_sum[i] ?? 0;
    b.hum_sum    += d.relative_humidity_2m_mean?.[i] ?? 0;
    if ((d.precipitation_sum[i] ?? 0) >= 1.0) b.rain_days++;
  }

  return buckets.map((b, i) => {
    const yearN = b.year_count.size || 1;
    return {
      month: i + 1,
      temp_max: +(b.tmax_sum / b.days).toFixed(1),
      temp_min: +(b.tmin_sum / b.days).toFixed(1),
      temp_mean: +(b.tmean_sum / b.days).toFixed(1),
      rain_days: +(b.rain_days / yearN).toFixed(1),
      rain_mm: +(b.rain_sum / yearN).toFixed(0),
      humidity: +(b.hum_sum / b.days).toFixed(0),
    };
  });
}

(async () => {
  const seeds = destFilter ? DESTINATION_SEED.filter(s => s.destination === destFilter) : DESTINATION_SEED;
  if (seeds.length === 0) { console.error(`destination "${destFilter}" 시드 없음`); process.exit(1); }

  // 좌표 unique 그룹핑 (중복 fetch 방지) — 같은 좌표는 한 번만 Open-Meteo 호출
  const byCoord = new Map();
  for (const s of seeds) {
    const key = `${s.lat},${s.lon}`;
    if (!byCoord.has(key)) byCoord.set(key, { ...s, members: [] });
    byCoord.get(key).members.push(s.destination);
  }

  console.log(`📍 unique 좌표 ${byCoord.size}개 / 총 destination ${seeds.length}개`);

  let okCount = 0, skipCount = 0, failCount = 0;
  for (const group of byCoord.values()) {
    const { lat, lon, primary_city, country, members } = group;

    // 기존 데이터 체크 (force 아니면 스킵)
    if (!FORCE && !destFilter) {
      const { data: existing } = await sb
        .from('destination_climate')
        .select('destination, fetched_at')
        .in('destination', members);
      const allExist = existing && existing.length === members.length;
      if (allExist) { skipCount += members.length; continue; }
    }

    const timezone = tzLookup(Number(lat), Number(lon));
    const offset = getOffsetMinutes(timezone);

    console.log(`\n→ ${primary_city} (${country}) ${lat},${lon} → ${timezone} (KST${offset >= 0 ? '+' : ''}${offset}min)`);
    console.log(`   대상 destination: ${members.join(' / ')}`);

    let normals;
    try {
      normals = await fetchNormals(lat, lon);
    } catch (e) {
      console.error(`   ✗ Open-Meteo 실패: ${e.message}`);
      failCount += members.length;
      continue;
    }

    const fitness = normals.map(computeFitness);
    const summary = fitness.map(f => `${String(f.month).padStart(2,'0')}월:${f.score}`).join(' ');
    console.log(`   📊 ${summary}`);

    if (DRY) { okCount += members.length; continue; }

    for (const dest of members) {
      const { error } = await sb.from('destination_climate').upsert({
        destination: dest,
        primary_city, country,
        lat, lon, timezone, utc_offset_minutes: offset,
        monthly_normals: normals,
        fitness_scores: fitness,
        fetched_at: new Date().toISOString(),
      }, { onConflict: 'destination' });
      if (error) { console.error(`   ✗ ${dest}: ${error.message}`); failCount++; }
      else okCount++;
    }

    // Open-Meteo Historical API minutely limit이 빡빡해서 호출 사이 12초 대기 (분당 5회)
    await new Promise(r => setTimeout(r, 12000));
  }

  console.log(`\n${DRY ? '[DRY] ' : ''}완료: ${okCount}개 성공, ${skipCount}개 스킵 (이미 존재), ${failCount}개 실패`);
})();
