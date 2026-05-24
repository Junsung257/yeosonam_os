// Wikidata — 해외 관광지 검색 테스트
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const UA = 'YeosonamOS/1.0 test';

async function searchWikidata(keyword) {
  // 한국어 검색
  const url = (lang) => `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(keyword)}&language=${lang}&format=json&limit=2&type=item`;
  
  const rKo = await fetch(url('ko'), { headers: { 'User-Agent': UA } });
  if (rKo.ok) {
    const j = await rKo.json();
    if (j.search?.length > 0) return { lang: 'ko', results: j.search };
  }
  const rEn = await fetch(url('en'), { headers: { 'User-Agent': UA } });
  if (rEn.ok) {
    const j = await rEn.json();
    if (j.search?.length > 0) return { lang: 'en', results: j.search };
  }
  return null;
}

async function test() {
  // 실제 unmatched에 있는 해외 관광지 키워드들
  const tests = [
    '바나힐', 'Bà Nà Hills', 'Sun World Ba Na Hills', 'Golden Bridge', 'Golden Hands Bridge',
    '호이안', 'Hoi An', 'Hoi An Ancient Town',
    '다낭', 'Da Nang',
    '투본강', 'Thu Bon River',
    '마블마운틴', 'Marble Mountains',
    '미케비치', 'My Khe Beach',
    'Nha Trang', 'Ha Long Bay',
    'Phong Nha Cave',
  ];

  for (const keyword of tests) {
    await new Promise(r => setTimeout(r, 100));
    const res = await searchWikidata(keyword);
    if (res) {
      console.log(`\n=== "${keyword}" (${res.lang}) ===`);
      for (const r of res.results) {
        console.log(`  ${r.id}: ${r.label} — ${r.description || 'no desc'}`);
      }
    } else {
      console.log(`\n=== "${keyword}" === 검색 결과 없음`);
    }
  }
}

test();
