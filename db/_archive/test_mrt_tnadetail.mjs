// MRT MCP — searchTnas에서 gid 추출 → getTnaDetail
async function callMRT(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const r = await fetch('https://mcp-servers.myrealtrip.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body,
  });
  return r.json();
}

function extractGids(text) {
  // gid 추출: "gid":"숫자" 패턴
  const gids = [];
  const re = /"gid":"?(\d+)"?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!gids.includes(m[1])) gids.push(m[1]);
  }
  return gids;
}

function extractTitles(text) {
  const titles = [];
  const re = /"value":"[^"]{3,100}"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const val = m[0].replace(/"value":"/, '').replace(/"$/, '');
    if (val.length > 4 && !val.startsWith('[') && !val.startsWith('⭐') && !val.match(/^\d/)) {
      titles.push(val);
    }
  }
  return [...new Set(titles)].slice(0, 10);
}

async function main() {
  // 1) 다낭 투어 검색
  console.log('=== 다낭 투어 검색 ===');
  const res = await callMRT('tools/call', {
    name: 'searchTnas',
    arguments: { query: '다낭 바나힐 입장권', perPage: 5 }
  });
  const txt = res?.result?.content?.[0]?.text || '';
  const titles = extractTitles(txt);
  const gids = extractGids(txt);
  console.log('상품명:', titles.slice(0, 5));
  console.log('gid:', gids.slice(0, 3));
  
  // 2) 첫 번째 gid로 상세 조회
  if (gids.length > 0) {
    const detail = await callMRT('tools/call', {
      name: 'getTnaDetail',
      arguments: { gid: gids[0] }
    });
    const detailTxt = detail?.result?.content?.[0]?.text || '';
    console.log('\n=== getTnaDetail ===');
    console.log(detailTxt.slice(0, 1500));
  }
}
main();
