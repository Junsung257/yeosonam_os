/** Naver DataLab API 빠른 검증 — 다낭 / 삿포로 12개월 */
const fs = require('fs');
const env = {};
fs.readFileSync('.env.local', 'utf-8').split('\n').forEach(l => {
  const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim();
});

async function fetchNaver(keywordGroups) {
  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      timeUnit: 'month',
      keywordGroups,
    }),
  });
  if (!res.ok) throw new Error(`Naver ${res.status}: ${await res.text()}`);
  return res.json();
}

(async () => {
  const data = await fetchNaver([
    { groupName: '다낭', keywords: ['다낭', '다낭여행', '다낭패키지'] },
    { groupName: '삿포로', keywords: ['삿포로', '삿포로여행', '북해도', '홋카이도'] },
    { groupName: '호치민', keywords: ['호치민', '호치민여행'] },
    { groupName: '오키나와', keywords: ['오키나와', '오키나와여행'] },
    { groupName: '치앙마이', keywords: ['치앙마이', '치앙마이여행'] },
  ]);

  for (const r of data.results) {
    console.log(`\n=== ${r.title} ===`);
    if (r.data.length === 0) { console.log('  (데이터 없음)'); continue; }
    const ratios = r.data.map(d => d.ratio);
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    for (const d of r.data) {
      const idx = d.ratio / avg;
      const bar = '█'.repeat(Math.round(d.ratio / 5));
      console.log(`  ${d.period.slice(0, 7)}  ${d.ratio.toFixed(1).padStart(6)}  (${idx.toFixed(2)}x)  ${bar}`);
    }
  }
})();
