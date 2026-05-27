(async () => {
  const r = await fetch('http://localhost:3001/packages/1e82f388-5cca-4d9a-8f53-10f4b0bb17b1', { cache: 'no-store' });
  const html = await r.text();
  function find(k) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m);
    return (html.match(new RegExp(escaped, 'g')) || []).length;
  }
  console.log('Length:', html.length);
  console.log('\n[검증 — day별 attraction 노출 카운트]');
  const items = [
    ['민예거리','day1'],['긴린호수','day1'],['가마도지옥','day1'],['유노하나','day1'],
    ['대관봉','day2'],['쿠로가와 온천','day2'],['뇨이린지','day2'],
    ['미야지다케','day3'],['큐다이숲','day3'],['후쿠오카 타워','day3'],['모모치','day3'],['라라포트','day3'],
  ];
  for (const [name, day] of items) console.log(`  [${day}] ${name}: ${find(name)}`);

  console.log('\n[카드 마커]');
  console.log('  AttractionPhotoSlide:', find('AttractionPhotoSlide'));
  console.log('  src_medium:', find('src_medium'));
  console.log('  pexels URL:', find('images.pexels.com/photos/'));
  console.log('  attraction_ids:', find('attraction_ids'));

  // 후쿠오카 타워 + 모모치 라인 주변 컨텍스트
  const idx = html.indexOf('후쿠오카 타워 외관');
  if (idx >= 0) {
    console.log('\n[day 3 idx 5 라인 주변 1500자]:');
    console.log(html.slice(idx, idx + 1500));
  } else {
    console.log('\n❌ "후쿠오카 타워 외관" 텍스트 자체 HTML에 없음 — schedule item 미렌더링');
  }
})().catch(e => console.error(e.message));
