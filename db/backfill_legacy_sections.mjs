/**
 * A1+A2 — 옛 등록물 section backfill 일괄 (2026-05-20 RC 플랜)
 *
 * 프로덕션/로컬 모두 HTTP → backfill-sections API (service role Bearer).
 * 후보 조회만: cron dry (dev 서버 또는 배포 URL)
 *   curl -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/legacy-sections-backfill?dry=1"
 *
 * 실행 (로컬 dev 서버 npm run dev 필요):
 *   node db/backfill_legacy_sections.mjs --dry
 *   node db/backfill_legacy_sections.mjs
 *   node db/backfill_legacy_sections.mjs --a1-only
 *   node db/backfill_legacy_sections.mjs --a2-only
 *
 * env: .env.local 또는 process.env
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   BACKFILL_BASE_URL (default http://localhost:3000)
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const envFile = fs.readFileSync(filePath, 'utf-8');
  envFile.split('\n').forEach(l => {
    const trimmed = l.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  });
}

const root = process.cwd();
loadEnvFile(path.join(root, '.env.local'));
loadEnvFile(path.join(root, '.env'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL(또는 SUPABASE_URL) 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const BASE = process.env.BACKFILL_BASE_URL || process.env.PROD_REVALIDATE_URL || 'http://localhost:3000';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const a1Only = args.includes('--a1-only');
const a2Only = args.includes('--a2-only');

function isBrokenExcludes(excludes) {
  if (!Array.isArray(excludes) || excludes.length < 100) return false;
  return excludes.every(x => typeof x === 'string' && x.length < 30);
}

async function backfillOne(id, force) {
  if (DRY) return { ok: true, dry: true, id, force };
  const res = await fetch(`${BASE}/api/admin/packages/${id}/backfill-sections`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, id, force, status: res.status, ...data };
}

async function main() {
  const { data: pkgs, error } = await sb
    .from('travel_packages')
    .select('id, title, price_dates, excludes, raw_text')
    .not('raw_text', 'is', null);
  if (error) { console.error('조회 실패:', error.message); process.exit(1); }

  const a1 = (pkgs || []).filter(p => !Array.isArray(p.price_dates) || p.price_dates.length === 0);
  const a2 = (pkgs || []).filter(p => isBrokenExcludes(p.excludes));

  console.log(`A1 (price_dates=0): ${a1.length}건`);
  console.log(`A2 (excludes broken 100+): ${a2.length}건`);
  console.log(`API: ${BASE}/api/admin/packages/{id}/backfill-sections${DRY ? ' [DRY]' : ''}`);

  const runA1 = !a2Only;
  const runA2 = !a1Only;

  let ok = 0, fail = 0;
  if (runA2) {
    for (const p of a2) {
      const r = await backfillOne(p.id, true);
      console.log(`${r.ok ? '✓' : '✗'} A2 ${p.title?.slice(0, 40)} → ${JSON.stringify(r).slice(0, 120)}`);
      if (r.ok) ok++; else fail++;
      if (!DRY) await new Promise(r => setTimeout(r, 500));
    }
  }
  if (runA1) {
    for (const p of a1) {
      if (runA2 && a2.some(x => x.id === p.id)) continue;
      const r = await backfillOne(p.id, false);
      console.log(`${r.ok ? '✓' : '✗'} A1 ${p.title?.slice(0, 40)} → ${JSON.stringify(r).slice(0, 120)}`);
      if (r.ok) ok++; else fail++;
      if (!DRY) await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}완료: ok=${ok} fail=${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
