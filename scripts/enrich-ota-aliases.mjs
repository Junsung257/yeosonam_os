#!/usr/bin/env node
/**
 * @file scripts/enrich-ota-aliases.mjs — 비용 0 OTA alias 보강 (2026-05-15)
 *
 * 사장님 비전 V5 — 하나투어/모두투어 검색으로 표기 정규화.
 * GitHub Actions cron (무료 quota 2000분/월) 에서 일 1회 실행:
 *   1. attractions 에서 alias 부족(<=1개) + 최근 시드(seeded_at >= 7일) 10건 select
 *   2. 각 attraction 에 대해 OTA 검색 + alias 추출 (playwright headless)
 *   3. UPDATE 후 ISR revalidate
 *
 * 사용량 예상: 10 attractions/day * ~10초 = 100초 → 월 50분 (free 2000분 안에 여유)
 *
 * 환경변수:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (필수)
 *   - REVALIDATE_URL (선택, ISR 무효화용)
 *   - REVALIDATE_SECRET
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVALIDATE_URL = process.env.REVALIDATE_URL;
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;
const MAX_ATTRACTIONS = Number(process.env.OTA_MAX_PER_RUN ?? 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[OTA-Enrich] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USER_AGENT = 'YeosonamOS/1.0 (catalog enrich; contact: admin@yeosonam.com)';

async function fetchOtaWithBrowser(url) {
  const chromium = (await import('@sparticuz/chromium')).default;
  const { chromium: playwright } = await import('playwright-core');
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    const html = await page.content();
    return html.length >= 1000 ? html : null;
  } finally {
    await browser.close();
  }
}

function extractTitlesFromHtml(html) {
  const out = [];
  const m1 = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (m1) out.push(m1[1].trim());
  const altRe = /\balt=["']([^"']{2,60})["']/g;
  let m;
  while ((m = altRe.exec(html)) !== null) out.push(m[1].trim());
  const headerRe = /<h[2-4][^>]*>([^<]{2,80})<\/h[2-4]>/g;
  while ((m = headerRe.exec(html)) !== null) out.push(m[1].trim());
  return out;
}

function isPlausibleAlias(candidate, name) {
  const c = candidate.trim();
  if (c.length < 2 || c.length > 30) return false;
  if (/\d+박\d+일|\[(특가|즉시확정|얼리|할인|단독|PLUS|핫딜)\]|완전판|풀빌라|에어텔|크루즈|크리스마스|연말/i.test(c)) return false;
  for (let i = 0; i <= name.length - 3; i++) {
    const sub = name.slice(i, i + 3);
    if (/[가-힣]/.test(sub) && c.includes(sub)) return true;
  }
  const en = name.match(/[a-zA-Z]{4,}/);
  if (en && c.toLowerCase().includes(en[0].toLowerCase())) return true;
  return false;
}

async function enrichOne(attraction) {
  const name = attraction.name.trim();
  const sources = [
    { source: 'hanatour', url: `https://www.hanatour.com/search?keyword=${encodeURIComponent(name)}` },
    { source: 'modetour', url: `https://www.modetour.com/search?searchword=${encodeURIComponent(name)}` },
  ];
  const newAliases = new Set((attraction.aliases || []).map(a => a.toLowerCase().replace(/\s+/g, '')));
  const additions = [];

  for (const src of sources) {
    try {
      const html = await fetchOtaWithBrowser(src.url);
      if (!html) continue;
      const titles = extractTitlesFromHtml(html);
      for (const t of titles) {
        const parts = t.split(/[,，\/·\[\]【】｜|]/).map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          if (isPlausibleAlias(part, name) && part !== name) {
            const key = part.toLowerCase().replace(/\s+/g, '');
            if (!newAliases.has(key)) {
              newAliases.add(key);
              additions.push(part);
              if (additions.length >= 6) break;
            }
          }
        }
        if (additions.length >= 6) break;
      }
    } catch (e) {
      console.warn(`  [${src.source}] ${name} 실패: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  if (additions.length === 0) return { name, additions: 0 };

  const finalAliases = [...(attraction.aliases || []), ...additions];
  const { error } = await supabase
    .from('attractions')
    .update({ aliases: finalAliases })
    .eq('id', attraction.id);
  if (error) {
    console.warn(`  [DB] ${name} UPDATE 실패: ${error.message}`);
    return { name, additions: 0 };
  }
  console.log(`  ✓ ${name} +${additions.length} alias`);
  return { name, additions: additions.length };
}

async function main() {
  console.log('🎯 OTA alias enrichment 시작');

  // alias 0~1개 + 최근 7일 시드된 attraction 우선
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('attractions')
    .select('id, name, aliases, seeded_at')
    .eq('is_active', true)
    .not('seeded_at', 'is', null)
    .gte('seeded_at', sevenDaysAgo)
    .or('aliases.is.null,aliases.eq.{}')
    .limit(MAX_ATTRACTIONS);

  if (error) {
    console.error('[OTA-Enrich] SELECT 실패:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log('  대상 attraction 없음 — 종료');
    return;
  }
  console.log(`  대상: ${data.length}건`);

  let total = 0;
  for (const a of data) {
    const r = await enrichOne(a);
    total += r.additions;
  }

  console.log(`✅ 종료 — 총 ${total} alias 추가`);

  if (total > 0 && REVALIDATE_URL && REVALIDATE_SECRET) {
    try {
      await fetch(REVALIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: ['/packages'], secret: REVALIDATE_SECRET }),
      });
      console.log('  ISR revalidate 트리거');
    } catch (e) {
      console.warn('  revalidate 실패(무시):', e.message);
    }
  }
}

main().catch(e => {
  console.error('치명적 오류:', e);
  process.exit(1);
});
