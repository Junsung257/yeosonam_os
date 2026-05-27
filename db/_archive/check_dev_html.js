(async () => {
  const r = await fetch('http://localhost:3000/packages/7f485215-370b-423d-9ce1-31838ce26db6', { cache: 'no-store' });
  const html = await r.text();
  function find(k) { const e = k.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m); return (html.match(new RegExp(e, 'g')) || []).length; }
  console.log('Length:', html.length);
  console.log('\n[매칭 카드 분석 - 사장님 fix 후]');
  const lines = ['705년에 창건된 후지산의 수호신', '아라쿠라야마 센겐신사', '후지산 파노라마 로프웨이', '오시노핫카이', '미시마 스카이 워크', '길이 400m', '길이 약 900m', '호라이바시'];
  for (const l of lines) console.log('  ' + l + ': ' + find(l));
  console.log('  setAttractionModal callbacks:', find('setAttractionModal'));
  console.log('  UUID 시즈오카 8개 합계:', ['7a04cfba','b0f2e6e5','f578636c','95db1c9e','7c46307d','8c3ee6a2','99e1f332','6f3e70cb'].reduce((s, u) => s + find(u), 0));
})().catch(e => console.error(e.message));
