// MRT MCP searchTnas 테스트 — 해외 관광지 검색
async function callMRT(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const r = await fetch('https://mcp-servers.myrealtrip.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body,
  });
  const txt = await r.text();
  return JSON.parse(txt);
}

async function main() {
  const queries = ['다낭 바나힐', '나트랑', '푸꾸옥', '장가계'];
  for (const q of queries) {
    await new Promise(r => setTimeout(r, 500));
    const res = await callMRT('tools/call', {
      name: 'searchTnas',
      arguments: { query: q, perPage: 3 }
    });
    const txt = res?.result?.content?.[0]?.text || '';
    // 위젯 응답에서 상품명 추출
    const titles = (txt.match(/"value":\s*"[^"]{3,80}"/g) || [])
      .map(s => s.replace(/"value":\s*"/g, '').replace(/"$/, ''))
      .filter(t => t.length > 3 && t.length < 80 && !t.startsWith('['));
    const prices = (txt.match(/"value":\s*"\d{1,2}[,.]\d{3,}/g) || [])
      .map(s => s.replace(/"value":\s*"/g, ''));
    
    console.log(`\n=== MRT "${q}" 검색 결과 ===`);
    for (let i = 0; i < Math.min(titles.length, 5); i++) {
      console.log(`  ${i+1}. ${titles[i]}${prices[i] ? ' (' + prices[i] + '원)' : ''}`);
    }
  }
}
main();
