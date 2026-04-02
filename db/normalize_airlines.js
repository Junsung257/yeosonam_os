/**
 * 항공사 코드 정규화 스크립트
 * "에어부산", "BX (에어부산)", "Air Busan (BX)" → 전부 "BX"로 통일
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 항공사명 → 2글자 IATA 코드 매핑
const AIRLINE_MAP = {
  // 에어부산
  '에어부산': 'BX', 'Air Busan': 'BX', '부산 에어': 'BX', '에어부산BX': 'BX',
  // 진에어
  '진에어': 'LJ', 'Jin Air': 'LJ',
  // 제주항공
  '제주항공': '7C', 'Jeju Air': '7C',
  // 티웨이
  '티웨이': 'TW', '티웨이항공': 'TW', 'T\'way': 'TW', 'TW항공': 'TW',
  // 비엣젯
  '비엣젯': 'VJ', '비엣젯항공': 'VJ', '비엣젯 항공': 'VJ', 'VietJet': 'VJ',
  // 이스타
  '이스타': 'ZE', '이스타항공': 'ZE', 'Eastar': 'ZE',
  // 에어로K
  '에어로K': 'RF',
  // 대한항공
  '대한항공': 'KE', 'Korean Air': 'KE',
  // 아시아나
  '아시아나': 'OZ', 'Asiana': 'OZ',
  // 중국남방
  '중국남방항공': 'CZ', 'China Southern': 'CZ',
  // 중국동방
  '중국동방항공': 'MU', 'China Eastern': 'MU',
  // 산동항공
  '산동항공': 'SC', 'Shandong Airlines': 'SC',
  // 중국국제항공
  '중국국제항공': 'CA', 'Air China': 'CA',
  // 라오항공
  '라오항공': 'QV',
  // 에어아시아
  '에어아시아': 'D7', 'AirAsia': 'D7',
  // 세부퍼시픽
  '세부퍼시픽': '5J', 'Cebu Pacific': '5J',
  // 베트남항공
  '베트남항공': 'VN', 'Vietnam Airlines': 'VN',
};

function normalizeAirlineCode(raw) {
  if (!raw || raw.trim() === '') return null;
  const s = raw.trim();

  // 1. 이미 정규 코드 (2글자)이면 그대로
  if (/^[A-Z0-9]{2}$/.test(s)) return s;

  // 2. "BX781/BX782" → "BX" (편명 포함)
  const flightMatch = s.match(/^([A-Z]{2}|\d[A-Z])\d{2,4}/);
  if (flightMatch) return flightMatch[1];

  // 3. "BX (에어부산)" / "에어부산 (BX)" / "Air Busan (BX)" 패턴
  const parenCode = s.match(/\(([A-Z]{2}|\d[A-Z])\d{0,4}\)/);
  if (parenCode) return parenCode[1].replace(/\d+/, '');

  // 4. "에어부산 BX" / "에어부산BX" → 앞에 코드 추출
  const codeInText = s.match(/([A-Z]{2}|\d[A-Z])(?:\d{2,4})?/);

  // 5. 한글 항공사명으로 매핑
  for (const [name, code] of Object.entries(AIRLINE_MAP)) {
    if (s.includes(name)) return code;
  }

  // 6. 코드가 있으면 추출
  if (codeInText) return codeInText[1];

  // 7. 콤마 구분 복수 항공사 → 첫 번째만
  if (s.includes(',')) {
    const first = s.split(',')[0].trim();
    return normalizeAirlineCode(first);
  }

  return s; // 매핑 못 하면 원본 유지
}

async function main() {
  const { data: pkgs } = await sb.from('travel_packages').select('id, airline').not('airline', 'is', null);

  console.log('총 상품:', pkgs.length);

  // 정규화 전 고유값
  const before = new Set(pkgs.map(p => p.airline));
  console.log('정규화 전 고유값:', before.size, '종');

  let updated = 0;
  const changes = {};

  for (const pkg of pkgs) {
    const normalized = normalizeAirlineCode(pkg.airline);
    if (normalized !== pkg.airline) {
      const key = `"${pkg.airline}" → "${normalized}"`;
      changes[key] = (changes[key] || 0) + 1;

      await sb.from('travel_packages').update({ airline: normalized }).eq('id', pkg.id);
      updated++;
    }
  }

  console.log('\n변경:', updated, '건');
  console.log('\n변경 내역:');
  Object.entries(changes).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log('  ' + k + ' (' + v + '건)');
  });

  // 정규화 후 고유값
  const { data: after } = await sb.from('travel_packages').select('airline').not('airline', 'is', null);
  const afterSet = new Set(after.map(p => p.airline));
  console.log('\n정규화 후 고유값:', afterSet.size, '종');
  console.log('  ', [...afterSet].join(', '));
}

main().catch(e => console.error(e.message));
