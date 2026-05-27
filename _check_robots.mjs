import https from 'https';

const url = process.argv[2] || 'https://www.yeosonam.com/blog/%EC%97%AC%ED%96%89%EC%9E%90%EB%B3%B4%ED%97%98-%EB%B0%9B%EB%8A%94%EB%B2%95-2026';
const decodedUrl = decodeURIComponent(url);

https.get(decodedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Location:', res.headers.location || '(none)');
  console.log('X-Robots-Tag:', res.headers['x-robots-tag'] || '(none)');
  
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Find meta robots
    const robotMatches = [...data.matchAll(/<meta[^>]*?(?:name=[\"']robots[\"'][^>]*?content=[\"']([^\"']*)[\"']|content=[\"']([^\"']*)[\"'][^>]*?name=[\"']robots[\"'])[^>]*?\/?>/gi)];
    if (robotMatches.length > 0) {
      console.log('Meta robots:', robotMatches.map(m => m[1] || m[2]).join(', '));
    } else {
      console.log('Meta robots: not found');
    }
    
    // Check for noindex in head
    const hasNoindex = data.includes('noindex') || data.includes('NOINDEX');
    console.log('Contains noindex:', hasNoindex);
    
    // Check title
    const titleMatch = data.match(/<title>([^<]*)<\/title>/i);
    console.log('Title:', titleMatch ? titleMatch[1].slice(0, 100) : '(none)');
    
    console.log('\nBody length:', data.length, 'bytes');
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});
