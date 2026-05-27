const PACKAGES = [
  ['후쿠오카', '1e82f388-5cca-4d9a-8f53-10f4b0bb17b1', ['민예거리','긴린호수','가마도지옥','유노하나','대관봉','쿠로가와','뇨이린지','미야지다케','큐다이숲','후쿠오카 타워']],
  ['시즈오카', '7f485215-370b-423d-9ce1-31838ce26db6', ['니혼다이라','미호노','오부치사사바','아라쿠라야마','후지산 파노라마','오시노핫카이','미시마 스카이','호라이바시']],
  ['청도',     '174e159b-5e8f-4579-935b-9370cd89da67', []],
  ['계림 3박', '3a136d76-79c0-44f2-aa1a-8e8d4cbdb12a', []],
  ['서안 3박', 'def2d595-3e9e-4631-8adc-58a7e7a99559', []],
];

function findCount(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m);
  return (html.match(new RegExp(escaped, 'g')) || []).length;
}

(async () => {
  for (const [label, id, keywords] of PACKAGES) {
    try {
      const r = await fetch(`https://yeosonam.com/packages/${id}`, { cache: 'no-store' });
      const html = await r.text();
      console.log(`\n=== ${label} (${id.slice(0, 8)}) — ${html.length} bytes ===`);
      console.log(`  hero: title=${findCount(html, 'display_title')} tagline=${findCount(html, 'hero_tagline')}`);
      console.log(`  attraction-images (pexels): ${findCount(html, 'images.pexels.com/photos/')}`);
      console.log(`  schedule_attraction_ids 키: ${findCount(html, 'attraction_ids')}`);
      console.log(`  price_dates 키: ${findCount(html, 'price_dates')}`);
      console.log(`  notices_parsed 키: ${findCount(html, 'notices_parsed')}`);
      console.log(`  ,000원 출현: ${findCount(html, ',000원')}`);
      if (keywords.length > 0) {
        console.log(`  attraction 이름 출현:`);
        for (const k of keywords) console.log(`    ${k}: ${findCount(html, k)}`);
      }
    } catch (e) {
      console.log(`${label}: FAIL ${e.message}`);
    }
  }
})();
