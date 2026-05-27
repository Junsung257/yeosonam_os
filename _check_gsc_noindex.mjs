import https from 'https';

const BASE_URL = 'https://www.yeosonam.com';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Googlebot)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function httpGetFull(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Googlebot)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode, body: data,
        hasNoindex: data.includes('noindex'),
        title: (data.match(/<title>([^<]*)<\/title>/i) || [])[1] || '',
      }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 1. 블로그 전체 목록 조회 ===');
  const apiResult = await httpGet(`${BASE_URL}/api/blog?limit=500`);
  if (apiResult.status !== 200) {
    console.log(`API error: ${apiResult.status}`);
    return;
  }
  
  let slugs = [];
  try {
    const json = JSON.parse(apiResult.body);
    slugs = (json.posts || json.data || []).map(p => p.slug).filter(Boolean);
    console.log(`총 ${slugs.length}개 slug 수집`);
    if (slugs.length < 10) {
      console.log('slug 예시:', slugs.slice(0, 5));
    }
  } catch (err) {
    console.log('JSON 파싱 실패:', err.message);
    console.log('첫 300자:', apiResult.body.slice(0, 300));
    return;
  }

  if (slugs.length === 0) {
    console.log('slug 없음');
    return;
  }

  console.log(`\n=== 2. ${slugs.length}개 블로그 noindex 검사 (300ms 간격) ===`);
  
  const problems = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const encodedSlug = encodeURIComponent(slug);
    const url = `${BASE_URL}/blog/${encodedSlug}`;
    
    try {
      const result = await httpGetFull(url);
      
      if (result.hasNoindex || result.status === 404) {
        problems.push({ slug, url, status: result.status, hasNoindex: result.hasNoindex, title: result.title });
        console.log(`  [${result.hasNoindex ? 'NOINDEX' : '404'}] ${slug}`);
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.log(`  [ERROR] ${slug}: ${err.message}`);
    }

    if ((i + 1) % 50 === 0) console.log(`  ... ${i + 1}/${slugs.length} 완료`);
  }

  console.log(`\n=== 3. 결과 요약 ===`);
  console.log(`검사한 글: ${slugs.length}개`);
  console.log(`NOINDEX 문제: ${problems.filter(u => u.hasNoindex).length}개`);
  console.log(`404 문제: ${problems.filter(u => u.status === 404).length}개`);

  if (problems.length > 0) {
    console.log(`\n=== 4. 문제 URL 목록 ===`);
    // GSC와 동일한 형식으로 출력
    console.log(`\n---- NOINDEX (${problems.filter(u => u.hasNoindex).length}개) ----`);
    for (const u of problems.filter(u => u.hasNoindex)) {
      console.log(`  ${u.url}`);
    }
    
    const _404s = problems.filter(u => u.status === 404);
    if (_404s.length > 0) {
      console.log(`\n---- 404 / Soft 404 (${_404s.length}개) ----`);
      for (const u of _404s) {
        console.log(`  ${u.url}`);
      }
    }
  } else {
    console.log('\n모든 발행된 블로그 글이 정상적으로 index 가능 상태입니다.');
  }
}

main().catch(console.error);
