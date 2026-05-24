// Overpass API — 전 세계 관광지 검색 테스트 (bbox 없이 name 일치)
async function searchOverpass(keyword) {
  const q = `[out:json][timeout:8];nwr["name"="${keyword}"];out 5;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: { 'User-Agent': 'YeosonamOS/1.0 test' } });
  if (!res.ok) return null;
  const json = await res.json();
  return json.elements?.slice(0, 5) || [];
}

async function test() {
  const tests = ['바나힐', 'Bà Nà Hills', 'Golden Bridge', 'Hoi An', 'Da Nang', 'Sun World Ba Na Hills'];
  
  for (const keyword of tests) {
    const results = await searchOverpass(keyword);
    console.log(`\n=== "${keyword}" ===`);
    if (results.length === 0) {
      console.log('  검색 결과 없음');
    } else {
      for (const e of results) {
        const tags = e.tags || {};
        console.log(`  name:${tags.name} | ko:${tags['name:ko'] || '-'} | type:${e.type} | tourism:${tags.tourism || '-'} | historic:${tags.historic || '-'} | lat:${e.lat || e.center?.lat || '-'}`);
      }
    }
    // Overpass rate limit: 1초
    await new Promise(r => setTimeout(r, 1500));
  }
}

test();
