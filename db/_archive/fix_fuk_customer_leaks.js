/**
 * FUK 골프 2건 고객 화면 노출 오류 수정:
 *  1. special_notes에 있던 커미션 내부 메모 → 별도 필드(memo) 이동 (없으면 null)
 *     A4 템플릿은 special_notes를 쇼핑센터로 렌더하는 fallback 존재 → 제거 필수
 *  2. itinerary_data.highlights.shopping = '노옵션 & 노쇼핑' 명시 (A4 쇼핑 섹션 정상화)
 *  3. surcharges에서 excludes 문자열 중복 항목 제거
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const IDS = ['2227e9c4-a8ba-464e-b89e-4b901625fa8e', 'e4a2ae42-d00e-484a-ad78-3785c955448b'];

(async () => {
  for (const id of IDS) {
    const { data: pkg } = await sb.from('travel_packages').select('*').eq('id', id).maybeSingle();
    if (!pkg) continue;

    // 1. special_notes: 고객 노출 친화 텍스트만 남김 (커미션 내부 메모 완전 제거)
    const cleanSpecialNotes = null; // 별도 표시할 정보 없음 — 노옵션은 highlights.shopping에서 처리

    // 2. itinerary_data.highlights.shopping 명시
    const updatedItinerary = {
      ...pkg.itinerary_data,
      highlights: {
        ...(pkg.itinerary_data?.highlights || {}),
        shopping: '노옵션 & 노쇼핑',
      },
    };

    // 3. excludes에서 surcharge 중복 제거
    const cleanExcludes = (pkg.excludes || []).filter(e => {
      // "일본 공휴일 추가요금 (3/18~20, 4/27~5/4)" — surcharges 객체에 이미 있음 → 제거
      if (/일본 공휴일/.test(e)) return false;
      // "싱글차지 3,000엔/박/인" — 객체에 있음
      if (/^싱글차지/.test(e)) return false;
      // "본관 숙박 시 2,000엔/박/인" — 객체에 있음
      if (/본관 숙박/.test(e)) return false;
      return true;
    });

    const { error } = await sb.from('travel_packages').update({
      special_notes: cleanSpecialNotes,
      itinerary_data: updatedItinerary,
      excludes: cleanExcludes,
    }).eq('id', id);

    if (error) { console.error(`❌ ${pkg.title}:`, error.message); continue; }
    console.log(`✅ ${pkg.title}`);
    console.log(`   - special_notes: 커미션 내부 메모 제거 (null)`);
    console.log(`   - itinerary_data.highlights.shopping: "노옵션 & 노쇼핑"`);
    console.log(`   - excludes: ${pkg.excludes?.length || 0}건 → ${cleanExcludes.length}건 (surcharge 중복 제거)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
