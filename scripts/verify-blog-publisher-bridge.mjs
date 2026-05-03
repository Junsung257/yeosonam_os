#!/usr/bin/env node
/**
 * 카드뉴스 → `publisher_bridge` 수동 검증 (가능한 한 “알아서”).
 *
 * - CARD_NEWS_ID 없으면: Supabase(service role)에서 슬라이드 URL 있는 최근 카드 1건 자동 선택
 * - BASE_URL: BRIDGE_VERIFY_BASE_URL → BASE_URL → localhost:3000 순으로 살아 있는 호스트만 시도
 *
 * 사용:
 *   npm run verify:blog-bridge:dry
 *   npm run verify:blog-bridge
 */

import { existsSync } from 'fs';
import { config } from 'dotenv';

if (existsSync('.env.local')) config({ path: '.env.local' });
config();

const dryRun = process.argv.includes('--dry-run');

const secret = process.env.CRON_SECRET || '';
let cardNewsId = (process.env.CARD_NEWS_ID || '').trim();
let slideUrls = (process.env.SLIDE_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isUuidLike(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function isPlaceholderCardId(id) {
  if (!id) return true;
  if (!isUuidLike(id)) return true;
  if (/여기|example|test-uuid|^uuid$/i.test(id)) return true;
  return false;
}

/** Supabase REST로 슬라이드가 있는 card_news 1건 */
async function pickCardNewsFromDb() {
  if (!supabaseUrl || !serviceKey) {
    console.error('[auto] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 없음 → 카드 자동 선택 불가.');
    return null;
  }

  const url = `${supabaseUrl}/rest/v1/card_news?select=id,slide_image_urls,updated_at&order=updated_at.desc&limit=25`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) {
    console.error('[auto] card_news 조회 실패:', res.status, await res.text().then((t) => t.slice(0, 200)));
    return null;
  }
  const rows = await res.json();
  for (const row of rows) {
    const urls = row.slide_image_urls;
    const arr = Array.isArray(urls) ? urls : typeof urls === 'string' ? (() => { try { return JSON.parse(urls); } catch { return []; } })() : [];
    const httpUrls = arr.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    if (httpUrls.length > 0) return { id: row.id, slide_image_urls: httpUrls };
  }
  console.error('[auto] 슬라이드 URL이 있는 card_news 가 없습니다.');
  return null;
}

async function hostResponds(base) {
  const root = base.replace(/\/$/, '');
  try {
    const r = await fetch(`${root}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3500),
    });
    return r.status < 500;
  } catch {
    return false;
  }
}

/** 살아 있는 Next 앱 베이스 URL 하나 */
async function resolveBaseUrl() {
  const explicit = (process.env.BRIDGE_VERIFY_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, '');
  const fromNext = (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const candidates = [];
  if (explicit) candidates.push(explicit);
  candidates.push('http://127.0.0.1:3000', 'http://localhost:3000');
  if (fromNext && !candidates.includes(fromNext)) candidates.push(fromNext);
  if (!candidates.includes('https://yeosonam.com')) candidates.push('https://yeosonam.com');

  const seen = new Set();
  const uniq = candidates.filter((u) => {
    if (!u || !/^https?:\/\//i.test(u)) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  for (const base of uniq) {
    if (await hostResponds(base)) {
      console.log('[auto] 사용할 BASE_URL =', base);
      return base;
    }
  }
  return null;
}

function printCurl(baseUrl) {
  console.log('\n--- curl 예시 (브리지만, draft INSERT 없음) ---\n');
  console.log(`curl -sS -X POST "${baseUrl}/api/blog/from-card-news" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "Authorization: Bearer $CRON_SECRET" \\`);
  console.log(`  -d '{"card_news_id":"<UUID>","slide_image_urls":["https://...png"],"publisher_bridge":true}'`);
  console.log('\n기대: HTTP 200, publisher_bridge, blog_html, slug\n');
}

async function main() {
  if (dryRun) {
    printCurl((process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''));
    console.log('[dry-run] 실제 요청 없음.');
    process.exit(0);
  }

  if (!secret) {
    console.error('[error] .env.local 에 CRON_SECRET 이 필요합니다 (publisher_bridge 403 방지).');
    process.exit(1);
  }

  if (isPlaceholderCardId(cardNewsId)) {
    console.log('[auto] CARD_NEWS_ID 없거나 placeholder → DB에서 카드 선택 시도');
    const picked = await pickCardNewsFromDb();
    if (!picked) {
      console.error('[error] 수동으로 설정: $env:CARD_NEWS_ID="실제-uuid"');
      process.exit(1);
    }
    cardNewsId = picked.id;
    if (slideUrls.length === 0) slideUrls = picked.slide_image_urls;
    console.log('[auto] card_news_id =', cardNewsId, '| slides =', slideUrls.length, '장');
  }

  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) {
    console.error('\n[error] 접속 가능한 사이트가 없습니다.');
    console.error('  → `npm run dev` 로 로컬을 켜거나, $env:BRIDGE_VERIFY_BASE_URL="https://배포주소"');
    process.exit(1);
  }

  printCurl(baseUrl);

  const url = `${baseUrl}/api/blog/from-card-news`;
  const body = {
    card_news_id: cardNewsId,
    slide_image_urls: slideUrls,
    publisher_bridge: true,
  };

  console.log(`POST ${url}`);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240000),
    });
  } catch (err) {
    const code = err?.cause?.code ?? err?.code;
    if (code === 'ECONNREFUSED') {
      console.error('\n[연결 거부]', baseUrl);
      console.error('  → `npm run dev` 또는 BRIDGE_VERIFY_BASE_URL 을 살아 있는 URL로.');
      process.exit(1);
    }
    throw err;
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('응답(JSON 아님):', text.slice(0, 500));
    process.exit(1);
  }

  console.log('status', res.status);
  if (!res.ok) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const ok =
    json.publisher_bridge === true &&
    typeof json.blog_html === 'string' &&
    json.blog_html.length > 50 &&
    typeof json.slug === 'string';
  console.log('publisher_bridge:', json.publisher_bridge);
  console.log('slug:', json.slug);
  console.log('blog_html 길이:', (json.blog_html || '').length);
  if (!ok) {
    console.error('[error] 브리지 계약 불충족');
    process.exit(1);
  }
  console.log('[ok] 브리지 응답 정상');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
