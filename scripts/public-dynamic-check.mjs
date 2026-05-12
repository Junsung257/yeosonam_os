import fs from 'node:fs/promises';

const base = 'http://localhost:3000';

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getText(path) {
  const res = await fetchWithTimeout(`${base}${path}`);
  return await res.text();
}

function pickLinks(html, prefix, max) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href=[\"'](${escaped}[^\"']+)[\"']`, 'g');
  const found = new Set();
  let m;
  while ((m = re.exec(html)) !== null && found.size < max) found.add(m[1]);
  return [...found];
}

const urls = new Set([
  '/',
  '/packages',
  '/things-to-do',
  '/destinations',
  '/blog',
  '/concierge',
  '/group',
  '/group-inquiry',
  '/free-travel',
  '/products',
]);

const pkgApi = await fetchWithTimeout(`${base}/api/packages`).then((r) => r.json()).catch(() => null);
const pkgList = (pkgApi?.data || pkgApi || []).slice(0, 10);
for (const p of pkgList) {
  if (p?.id) urls.add(`/packages/${p.id}`);
}

const ttdHtml = await getText('/things-to-do').catch(() => '');
for (const link of pickLinks(ttdHtml, '/things-to-do/', 10)) urls.add(link);

const destHtml = await getText('/destinations').catch(() => '');
for (const link of pickLinks(destHtml, '/destinations/', 10)) urls.add(link);

const blogHtml = await getText('/blog').catch(() => '');
for (const link of pickLinks(blogHtml, '/blog/', 10)) urls.add(link);

const out = [];
for (const [idx, url] of [...urls].entries()) {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${base}${url}`, { redirect: 'manual' });
    await res.text();
    out.push({
      url,
      status: res.status,
      timeMs: Date.now() - started,
      location: res.headers.get('location') || '',
    });
  } catch (error) {
    out.push({
      url,
      status: 'ERR',
      timeMs: Date.now() - started,
      error: String(error?.message || error),
    });
  }
  console.log(`checked ${idx + 1}/${urls.size}: ${url}`);
}

await fs.writeFile('tmp-public-dynamic-check.json', JSON.stringify(out, null, 2), 'utf8');

const bad = out.filter((x) => x.status === 'ERR' || (typeof x.status === 'number' && x.status >= 400));
console.log('checked', out.length, 'bad', bad.length);
for (const b of bad.slice(0, 30)) {
  console.log('BAD', b.status, b.url, b.location || b.error || '');
}
console.log('slowest');
for (const s of [...out].sort((a, b) => b.timeMs - a.timeMs).slice(0, 15)) {
  console.log(`${s.timeMs}ms`, s.status, s.url);
}
