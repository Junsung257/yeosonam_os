// 여러 무료 POI 소스 테스트

async function testBizData() {
  // BizData: 무료, API 키 불필요
  const tests = [
    { city: 'seoul', category: 'museum' },
    { city: 'jeju', category: 'attraction' },
  ];
  for (const t of tests) {
    try {
      const r = await fetch(`https://bizdata-web.vercel.app/api/businesses?city=${t.city}&category=${t.category}&limit=3`);
      if (r.ok) {
        const j = await r.json();
        console.log(`[BizData] ${t.city}/${t.category}:`, JSON.stringify(j).slice(0, 400));
      } else {
        console.log(`[BizData] ${t.city}/${t.category}: 응답 ${r.status}`);
      }
    } catch(e) {
      console.log(`[BizData] ${t.city}/${t.category}: 오류 ${e.message}`);
    }
  }
}

async function testOverpass() {
  // Overpass API: 무료, 정확한 name 일치 검색
  const tests = [
    { name: '한라산', bounds: '33.0,126.0,34.0,127.0' },
    { name: '천지연폭포', bounds: '33.0,126.0,34.0,127.0' },
    { name: '만장굴', bounds: '33.0,126.0,34.0,127.0' },
    { name: '성산일출봉', bounds: '33.0,126.0,34.0,127.0' },
  ];
  for (const t of tests) {
    try {
      const q = `[out:json][timeout:8];nwr["name"="${t.name}"](${t.bounds});out 3;`;
      const r = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q),
        { headers: { 'User-Agent': 'YeosonamOS/1.0' } });
      if (r.ok) {
        const j = await r.json();
        console.log(`[Overpass] "${t.name}": ${j.elements?.length || 0}건`);
        for (const e of (j.elements || []).slice(0, 3)) {
          console.log(`   → name:${e.tags?.name}, type:${e.type}, tourism:${e.tags?.tourism}, historic:${e.tags?.historic || '-'}, lat:${e.lat || e.center?.lat}`);
        }
      } else {
        console.log(`[Overpass] "${t.name}": 응답 ${r.status}`);
      }
    } catch(e) {
      console.log(`[Overpass] "${t.name}": 오류 ${e.message}`);
    }
  }
}

async function testWikiDataDirect() {
  // Wikidata 직접 검색 (wbsearchentities)
  const tests = ['성산일출봉', '천지연폭포', '만장굴', '용두암', '한라산'];
  for (const t of tests) {
    try {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(t)}&language=ko&format=json&limit=1`;
      const r = await fetch(url, { headers: { 'User-Agent': 'YeosonamOS/1.0 test' } });
      if (r.ok) {
        const j = await r.json();
        const found = j.search?.[0];
        if (found) {
          console.log(`[Wikidata] "${t}": ${found.label} (${found.id}) — ${found.description || 'desc 없음'}`);
        } else {
          console.log(`[Wikidata] "${t}": 검색 결과 없음`);
        }
      }
    } catch(e) {
      console.log(`[Wikidata] "${t}": 오류 ${e.message}`);
    }
  }
}

async function main() {
  console.log('━━━ 무료 POI 소스 테스트 ━━━\n');
  
  console.log('--- 1. BizData API (무료, 키 불필요) ---');
  await testBizData();
  
  console.log('\n--- 2. Overpass API (무료, 키 불필요) ---');
  await testOverpass();
  
  console.log('\n--- 3. Wikidata API (무료, 키 불필요) ---');
  await testWikiDataDirect();
}

main();
