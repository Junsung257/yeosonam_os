#!/usr/bin/env node
/**
 * db/sync_mrt_attractions.js
 *
 * 인기 10개 도시의 MRT 호텔·투어 데이터를 attractions 테이블에 upsert.
 *
 * 사용법:
 *   node db/sync_mrt_attractions.js [--city 다낭] [--dry-run]
 *
 * 주의:
 *   - MRT 원본 텍스트(설명)는 저장하지 않음 (저작권)
 *   - 이름·카테고리·가격·평점·위치 메타만 저장
 *   - 이미지는 저장 안 함 (MRT 상품 컨텍스트 내에서만 사용)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const MCP_URL = 'https://mcp-servers.myrealtrip.com/mcp';
let _rpcId = 1;

async function mcpCall(toolName, args, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: _rpcId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error) return null;
    const text = json.result?.content?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 인기 10개 도시 (한국어 검색어 + 내부 지역 코드)
const TOP_CITIES = [
  { query: '다낭',       region: 'DA NANG',    country: 'VN' },
  { query: '나트랑',     region: 'NHA TRANG',  country: 'VN' },
  { query: '방콕',       region: 'BANGKOK',    country: 'TH' },
  { query: '도쿄',       region: 'TOKYO',      country: 'JP' },
  { query: '오사카',     region: 'OSAKA',      country: 'JP' },
  { query: '후쿠오카',   region: 'FUKUOKA',    country: 'JP' },
  { query: '싱가포르',   region: 'SINGAPORE',  country: 'SG' },
  { query: '발리',       region: 'BALI',       country: 'ID' },
  { query: '세부',       region: 'CEBU',       country: 'PH' },
  { query: '코타키나발루', region: 'KOTA KINABALU', country: 'MY' },
];

// mrt_category 결정
function inferCategory(item) {
  if (item._type === 'stay') return 'stay';
  if (item._type === 'tna')  return 'tna';
  return item.stayType ? 'stay' : 'tna';
}

// badge_type 결정 (기존 attractions 스키마)
function inferBadge(item) {
  if (item._type === 'stay') return 'hotel';
  const cat = (item.category || '').toLowerCase();
  if (cat.includes('tour') || cat.includes('투어')) return 'tour';
  if (cat.includes('ticket') || cat.includes('티켓')) return 'special';
  return 'tour';
}

async function syncCity(city, dryRun) {
  console.log(`\n[${city.query}] 동기화 시작...`);
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

  // 1. 호텔 조회
  const staysRaw = await mcpCall('searchStays', {
    keyword:    city.query,
    checkIn:    today,
    checkOut:   tomorrow,
    adultCount: 2,
    childCount: 0,
    isDomestic: false,
    page:       1,
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. 투어/액티비티 조회
  const tnasRaw = await mcpCall('searchTnas', {
    query:   city.query,
    perPage: 20,
    page:    1,
  });

  const rows = [];

  // 호텔 처리
  const stays = staysRaw?.items ?? staysRaw?.stays ?? staysRaw?.results ?? [];
  for (const s of stays) {
    const gid = String(s.gid ?? s.id ?? '');
    if (!gid) continue;
    const name = String(s.name ?? '').trim();
    if (!name) continue;

    rows.push({
      mrt_gid:          gid,
      mrt_category:     'stay',
      mrt_rating:       s.reviewRating ?? s.rating ?? null,
      mrt_review_count: s.reviewRatingCount ?? s.reviewCount ?? null,
      mrt_min_price:    Math.round(s.minPrice ?? s.pricePerNight ?? 0) || null,
      mrt_synced_at:    new Date().toISOString(),
      // attractions 기존 필드
      name:             name,
      badge_type:       'hotel',
      region:           city.region,
      country:          city.country,
      is_active:        true,
    });
  }

  // 투어/액티비티 처리
  const tnas = tnasRaw?.items ?? tnasRaw?.tnas ?? tnasRaw?.products ?? tnasRaw?.results ?? [];
  for (const t of tnas) {
    const gid = String(t.gid ?? t.id ?? '');
    if (!gid) continue;
    const name = String(t.title ?? t.name ?? '').trim();
    if (!name) continue;

    rows.push({
      mrt_gid:          gid,
      mrt_category:     'tna',
      mrt_rating:       t.reviewScore ?? t.rating ?? null,
      mrt_review_count: t.reviewCount ?? null,
      mrt_min_price:    Math.round(t.minPrice ?? t.price ?? 0) || null,
      mrt_synced_at:    new Date().toISOString(),
      name:             name,
      badge_type:       inferBadge({ ...t, _type: 'tna' }),
      region:           city.region,
      country:          city.country,
      is_active:        true,
    });
  }

  console.log(`  → 호텔 ${stays.length}건, 투어 ${tnas.length}건 (총 ${rows.length}건 upsert 예정)`);

  if (dryRun) {
    console.log('  [dry-run] DB 저장 건너뜀');
    return rows.length;
  }

  if (rows.length === 0) return 0;

  // mrt_gid 기준 upsert (name/rating/price 갱신만 허용)
  const { error } = await supabase
    .from('attractions')
    .upsert(rows, {
      onConflict:        'mrt_gid',
      ignoreDuplicates:  false,
    });

  if (error) {
    console.error(`  [오류] ${error.message}`);
    return 0;
  }

  console.log(`  ✓ ${rows.length}건 저장 완료`);
  return rows.length;
}

async function main() {
  const args    = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const cityArg = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;

  const cities = cityArg
    ? TOP_CITIES.filter(c => c.query === cityArg)
    : TOP_CITIES;

  if (cities.length === 0) {
    console.error(`[오류] 도시 "${cityArg}"를 찾을 수 없습니다.`);
    console.log('지원 도시:', TOP_CITIES.map(c => c.query).join(', '));
    process.exit(1);
  }

  console.log(`MRT → attractions 동기화 시작 (${dryRun ? 'DRY RUN' : '실제 저장'})`);
  console.log(`대상 도시: ${cities.map(c => c.query).join(', ')}`);

  let total = 0;
  for (const city of cities) {
    total += await syncCity(city, dryRun);
    // 도시 간 1s 딜레이 (Rate Limit 방어)
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n완료: 총 ${total}건 처리`);
}

main().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
