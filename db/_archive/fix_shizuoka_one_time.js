/**
 * 1회용 즉시 픽스 — 2026-05-16
 *
 * 시즈오카 패키지 7f485215-370b-423d-9ce1-31838ce26db6 모바일 상세에서
 * attraction 카드 사진이 안 보이던 문제 픽스.
 *
 * 처리 내용:
 * 1. 시즈오카 attractions 7개 + 오시노핫카이 1개의 photos[] 자동 채우기 (Pexels)
 * 2. 시즈오카 패키지 day 2 schedule "오시노핫카이" 라인에 attraction_ids 강제 매칭
 *    (오시노핫카이 region='하코네'라서 destination='시즈오카' 필터에서 자동 매칭 실패한 회귀 픽스)
 * 3. ISR revalidate 시도 (실패해도 무방 — 다음 ISR cycle에 자연 반영)
 *
 * 영구 픽스는 별도 PR (P1-D/P1-E)에서 진행 — 본 스크립트는 1회 실행 후 보관.
 *
 * 실행: node db/fix_shizuoka_one_time.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVAL_SECRET = process.env.REVALIDATE_SECRET;

if (!PEXELS_KEY || !SUPA_URL || !SUPA_KEY) {
  console.error('환경변수 누락. PEXELS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 확인.');
  process.exit(1);
}

const supa = createClient(SUPA_URL, SUPA_KEY);

const PACKAGE_ID = '7f485215-370b-423d-9ce1-31838ce26db6';
const OSHINO_ID = '6f3e70cb-e64e-4804-b784-6b3f1be5b6b3';

const ATTRACTIONS = [
  { id: '7a04cfba-da6b-469a-a1aa-61f4fb1bb598', name: '니혼다이라 로프웨이', kw: 'Nihondaira Ropeway Shizuoka Japan' },
  { id: 'b0f2e6e5-1153-4838-9b38-e46291cb409c', name: '미호노 마츠바라', kw: 'Miho no Matsubara Shizuoka pine beach' },
  { id: 'f578636c-94c5-495f-87fb-3a3e510d9834', name: '오부치사사바', kw: 'Obuchi Sasaba tea fields Mount Fuji' },
  { id: '95db1c9e-be84-4606-8abc-ca0d38031cb0', name: '아라쿠라야마 센겐신사', kw: 'Arakurayama Sengen Shrine Chureito Pagoda Mt Fuji' },
  { id: '7c46307d-50ae-4d0b-847a-6803f339d266', name: '후지산 파노라마 로프웨이', kw: 'Mt Fuji Panorama Ropeway Kawaguchiko' },
  { id: '8c3ee6a2-4b9a-4fa8-a515-1b055076fdbc', name: '미시마 스카이 워크', kw: 'Mishima Skywalk suspension bridge Japan' },
  { id: '99e1f332-d968-41c8-b1bc-6de0a5bcb313', name: '호라이바시', kw: 'Horaibashi wooden bridge Shimada Japan' },
  { id: OSHINO_ID, name: '오시노핫카이', kw: 'Oshino Hakkai Mt Fuji ponds Japan' },
];

async function pexels(kw, perPage = 3) {
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(kw)}&per_page=${perPage}`, {
    headers: { Authorization: PEXELS_KEY },
  });
  if (!r.ok) throw new Error(`Pexels ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.photos || []).map((p) => ({
    pexels_id: p.id,
    src_medium: p.src.medium,
    src_large: p.src.large2x,
    photographer: p.photographer,
    alt: p.alt || kw,
  }));
}

async function step1FillPhotos() {
  console.log('\n[Step 1] Pexels 사진 자동 채우기');
  let success = 0;
  for (const a of ATTRACTIONS) {
    try {
      const { data: existing } = await supa.from('attractions').select('photos').eq('id', a.id).limit(1);
      const cur = (existing?.[0]?.photos) || [];
      if (Array.isArray(cur) && cur.length > 0) {
        console.log(`  - 스킵 (기존 ${cur.length}장 보유): ${a.name}`);
        success++;
        continue;
      }
      const photos = await pexels(a.kw, 3);
      if (photos.length === 0) {
        console.log(`  ✗ 검색 0건: ${a.name} ("${a.kw}")`);
        continue;
      }
      const { error } = await supa.from('attractions').update({ photos, updated_at: new Date().toISOString() }).eq('id', a.id);
      if (error) throw error;
      console.log(`  ✓ ${photos.length}장 저장: ${a.name}`);
      success++;
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      console.log(`  ✗ 실패 (${a.name}): ${e.message}`);
    }
  }
  console.log(`[Step 1] ${success}/${ATTRACTIONS.length} 완료`);
}

async function step2AttachOshino() {
  console.log('\n[Step 2] 오시노핫카이 day 2 강제 매칭');
  const { data: pkgs } = await supa.from('travel_packages').select('itinerary_data').eq('id', PACKAGE_ID).limit(1);
  const pkg = pkgs?.[0];
  if (!pkg) { console.log('  ✗ 패키지 없음'); return; }
  const itin = JSON.parse(JSON.stringify(pkg.itinerary_data));
  let changed = false;
  for (const day of (itin.days || [])) {
    for (const item of (day.schedule || [])) {
      const act = String(item.activity || '');
      if (act.includes('오시노핫카이') || act.includes('오시노 핫카이')) {
        const existing = Array.isArray(item.attraction_ids) ? item.attraction_ids : [];
        if (!existing.includes(OSHINO_ID)) {
          item.attraction_ids = [...existing, OSHINO_ID];
          changed = true;
          console.log(`  ✓ day ${day.day} attaching: "${act.slice(0, 40)}..."`);
        } else {
          console.log(`  - 이미 박힘 (day ${day.day})`);
        }
      }
    }
  }
  if (!changed) { console.log('  - 변경 없음'); return; }
  const { error } = await supa.from('travel_packages').update({ itinerary_data: itin, updated_at: new Date().toISOString() }).eq('id', PACKAGE_ID);
  if (error) console.log('  ✗ UPDATE 실패:', error.message);
  else console.log('  ✓ 패키지 UPDATE 완료');
}

async function step3Revalidate() {
  console.log('\n[Step 3] ISR revalidate 시도');
  if (!REVAL_SECRET) { console.log('  - REVALIDATE_SECRET 없음, 스킵'); return; }
  const candidates = ['https://yeosonam.com', 'https://www.yeosonam.com'];
  const paths = [`/packages/${PACKAGE_ID}`, `/m/packages/${PACKAGE_ID}`];
  for (const base of candidates) {
    try {
      const r = await fetch(`${base}/api/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, secret: REVAL_SECRET }),
      });
      const txt = await r.text();
      console.log(`  ${base} → ${r.status} ${txt.slice(0, 200)}`);
      if (r.ok) return;
    } catch (e) {
      console.log(`  ${base} → fail: ${e.message}`);
    }
  }
}

(async () => {
  await step1FillPhotos();
  await step2AttachOshino();
  await step3Revalidate();
  console.log('\n✅ 1회용 픽스 완료');
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
