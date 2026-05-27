/**
 * 45건 사진 누락 attraction 일괄 매칭.
 * Wikidata QID → P18 (license safe 만) → Pexels (영어 alias 우선) fallback.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;
if (!SB_URL || !SB_KEY) { console.error('env 누락'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY);

const UA = 'YeosonamOS/1.0 admin@yeosonam.com';

async function searchWikidataQid(name) {
  for (const lang of ['ko', 'en']) {
    try {
      const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&format=json&limit=1&type=item`;
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      const j = await r.json();
      const id = j.search?.[0]?.id;
      if (id) return id;
    } catch {}
  }
  return null;
}

async function fetchP18Filename(qid) {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json();
    return j.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null;
  } catch { return null; }
}

async function fetchCommonsMeta(filename) {
  try {
    const title = filename.startsWith('File:') ? filename : `File:${filename}`;
    const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=1200&format=json&formatversion=2`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const j = await r.json();
    const info = j.query?.pages?.[0]?.imageinfo?.[0];
    if (!info) return null;
    const license = info.extmetadata?.LicenseShortName?.value ?? '';
    const author = (info.extmetadata?.Artist?.value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const safe = !license.toLowerCase().includes('sa') &&
      (license.toLowerCase().includes('cc0') || license.toLowerCase().includes('public domain') || license.toLowerCase().includes('cc-by') || license.toLowerCase() === 'cc by');
    if (!safe) return null;
    return {
      thumb_url: info.thumburl ?? info.url,
      full_url: info.url,
      desc_url: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      license,
      author: author || 'Wikimedia Commons',
    };
  } catch { return null; }
}

function pickEnglishAlias(aliases) {
  if (!Array.isArray(aliases)) return null;
  for (const a of aliases) {
    if (typeof a !== 'string' || a.length < 2) continue;
    const ascii = a.replace(/[^\x20-\x7E]/g, '');
    if (ascii.length / a.length > 0.8) return a;
  }
  return null;
}

async function searchPexels(keyword, perPage = 3) {
  if (!PEXELS_KEY) return [];
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keyword)}&per_page=${perPage}`;
    const r = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.photos ?? []).map(p => ({
      pexels_id: p.id,
      src_medium: p.src.medium,
      src_large: p.src.large2x ?? p.src.large,
      photographer: p.photographer,
      alt: p.alt ?? '',
    }));
  } catch { return []; }
}

async function main() {
  const { data: targets } = await sb
    .from('attractions')
    .select('id, name, region, country, aliases, wikidata_qid, photos, is_manual_override')
    .eq('is_active', true)
    .not('category', 'eq', 'accommodation')
    .is('mrt_gid', null)
    .or('photos.is.null,photos.eq.[]')
    .eq('is_manual_override', false);

  if (!targets) { console.error('fetch 실패'); return; }
  console.log(`대상: ${targets.length}건`);

  let filledWiki = 0, filledPexels = 0, skipped = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    process.stdout.write(`[${i+1}/${targets.length}] ${t.name.slice(0,18)} ... `);

    let photos = [];
    let qid = t.wikidata_qid;

    // 1) Wikidata QID 검색 (없으면)
    if (!qid) qid = await searchWikidataQid(t.name);

    // 2) P18 + Commons license safe
    if (qid) {
      const filename = await fetchP18Filename(qid);
      if (filename) {
        const meta = await fetchCommonsMeta(filename);
        if (meta) {
          photos.push({
            pexels_id: 0,
            src_medium: meta.thumb_url,
            src_large: meta.full_url,
            photographer: meta.author,
            alt: `${t.name} (Wikidata ${qid})`,
            license: meta.license,
            source_url: meta.desc_url,
          });
        }
      }
    }

    // 3) Pexels fallback (영어 alias 우선)
    if (photos.length === 0) {
      const eng = pickEnglishAlias(t.aliases);
      const keyword = eng || `${t.name} ${t.region || t.country || ''} travel`.trim();
      photos = await searchPexels(keyword, 3);
    }

    if (photos.length === 0) { console.log('NO PHOTO'); skipped++; continue; }

    const updateData = { photos, updated_at: new Date().toISOString() };
    if (qid && !t.wikidata_qid) updateData.wikidata_qid = qid;

    const { error } = await sb
      .from('attractions')
      .update(updateData)
      .eq('id', t.id)
      .eq('is_manual_override', false);
    if (error) { console.log('UPDATE FAIL:', error.message); skipped++; continue; }

    if (photos[0].pexels_id === 0) { filledWiki++; console.log(`Wikimedia ✓ (${photos[0].license})`); }
    else { filledPexels++; console.log(`Pexels ✓ (${photos.length}장)`); }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n=== 종합 ===`);
  console.log(`  Wikimedia P18: ${filledWiki}건 / Pexels: ${filledPexels}건 / skip: ${skipped}건`);
}

main().catch(e => console.error(e.message));
