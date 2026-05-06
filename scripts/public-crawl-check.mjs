const base = 'http://localhost:3000';
const seen = new Set();
const queue = ['/'];
const results = [];
const max = 80;

function normalizeUrl(raw) {
  try {
    const u = new URL(raw, base);
    if (u.origin !== base) return null;
    u.hash = '';
    const path = `${u.pathname}${u.search || ''}`;
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return null;
  }
}

function extractLinks(html) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

while (queue.length && results.length < max) {
  const path = queue.shift();
  if (!path || seen.has(path)) continue;
  seen.add(path);

  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await fetch(`${base}${path}`, { redirect: 'manual', signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');
    results.push({
      path,
      status: res.status,
      timeMs: Date.now() - started,
      location: res.headers.get('location') || '',
      isHtml,
    });

    if (res.status === 200 && isHtml) {
      const links = extractLinks(text);
      for (const link of links) {
        const n = normalizeUrl(link);
        if (!n) continue;
        if (n.startsWith('/api/')) continue;
        if (!seen.has(n) && !queue.includes(n)) queue.push(n);
      }
    }
  } catch (error) {
    results.push({
      path,
      status: 'ERR',
      timeMs: Date.now() - started,
      error: String(error?.message || error),
    });
  }
}

const byStatus = results.reduce((acc, row) => {
  const key = String(row.status);
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const bad = results.filter(
  (r) => r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 400),
);
const slow = [...results]
  .filter((r) => typeof r.timeMs === 'number')
  .sort((a, b) => b.timeMs - a.timeMs)
  .slice(0, 20);

await import('node:fs/promises').then((fs) =>
  fs.writeFile('tmp-crawl-results.json', JSON.stringify(results, null, 2), 'utf8'),
);

console.log('visited', results.length);
console.log('status', JSON.stringify(byStatus));
console.log('bad_count', bad.length);
for (const b of bad.slice(0, 30)) {
  console.log('BAD', b.status, b.path, b.location || b.error || '');
}
console.log('slowest');
for (const s of slow) {
  console.log(`${s.timeMs}ms`, s.status, s.path, s.location ? `-> ${s.location}` : '');
}
