// Overpass API 테스트 — 한국 관광지 검색
// 간단한 검색: 제주도 관광지
const q1 = `[out:json][timeout:10];
node(33.2,126.1,33.6,126.9)["tourism"="attraction"];
out 5;`;

const r1 = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q1),
  { headers: { 'User-Agent': 'YeosonamOS/1.0 test' } });
const j1 = await r1.json();
console.log('=== 제주 관광지 attractions (tourism=attraction) ===');
console.log('개수:', j1.elements?.length || 0);
for (const e of (j1.elements || []).slice(0, 10)) {
  console.log('  -', e.tags?.name, '/ ko:', e.tags?.['name:ko'] || '-', '/ tourism:', e.tags?.tourism, '/ historic:', e.tags?.historic || '');
}

// name:ko 태그가 있는 관광지
const q2 = `[out:json][timeout:10];
node(33.2,126.1,33.6,126.9)["name:ko"~"."]["tourism"~"attraction|museum|viewpoint"];
out 5;`;

const r2 = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q2),
  { headers: { 'User-Agent': 'YeosonamOS/1.0 test' } });
const j2 = await r2.json();
console.log('\n=== 제주 name:ko 있는 관광지 ===');
console.log('개수:', j2.elements?.length || 0);
for (const e of (j2.elements || []).slice(0, 10)) {
  console.log('  -', e.tags?.name, '/ ko:', e.tags?.['name:ko'] || '-', '/ tourism:', e.tags?.tourism);
}

// 키워드 검색 (searchQuery로 이름 검색)
const keyword = '성산일출봉';
const q3 = `[out:json][timeout:10];
node["name"~"${keyword}",i](33.0,124.0,39.0,132.0);
out 5;`;
const r3 = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q3),
  { headers: { 'User-Agent': 'YeosonamOS/1.0 test' } });
const j3 = await r3.json();
console.log(`\n=== "${keyword}" 검색 ===`);
console.log('개수:', j3.elements?.length || 0);
for (const e of (j3.elements || []).slice(0, 5)) {
  console.log('  -', e.tags?.name, '/ lat:', e.lat, '/ lon:', e.lon);
}
