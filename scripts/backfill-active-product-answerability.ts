#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { supabaseAdmin } from '../src/lib/supabase';

dotenv.config({ path: '.env.local' });
dotenv.config();

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  internal_code: string | null;
  short_code: string | null;
  country: string | null;
  product_highlights: string[] | null;
  product_summary: string | null;
  product_type: string | null;
  trip_style: string | null;
  airline: string | null;
  duration: number | null;
  nights: number | null;
  price_dates: unknown;
  inclusions: string[] | null;
  excludes: string[] | null;
};

type PatchRow = {
  id: string;
  title: string | null;
  destination: string | null;
  patch: {
    country?: string;
    short_code?: string;
    product_highlights?: string[];
  };
};

type Options = {
  apply: boolean;
  json: boolean;
  limit: number;
};

function parseOptions(args: string[]): Options {
  const rawLimit = Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? 1000);
  return {
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 2000) : 1000,
  };
}

function inferCountry(input: string): string | null {
  const text = input.normalize('NFC');
  const rules: Array<[RegExp, string]> = [
    [/푸꾸옥|나트랑|달랏|다낭|호이안|하노이|하롱|사파|호치민|베트남/i, '베트남'],
    [/장가계|서안|화산|광저우|천저우|계림|석가장|청도|북경|상해|연길|백두산|중국/i, '중국'],
    [/후쿠오카|북해도|홋카이도|시즈오카|카와구치|도쿄|아타미|이즈|하코네|벳부|대마도|일본/i, '일본'],
    [/방콕|파타야|후아힌|치앙마이|태국/i, '태국'],
    [/몽골|울란바토르|테를지|내몽고/i, '몽골'],
    [/보홀|세부|마닐라|필리핀/i, '필리핀'],
    [/발리|인도네시아/i, '인도네시아'],
    [/대만|타이베이/i, '대만'],
    [/말레이시아|코타키나발루/i, '말레이시아'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function buildShortCode(internalCode: string | null, id: string, used: Set<string>): string {
  const normalized = internalCode?.trim()
    ? internalCode
        .trim()
        .replace(/^(PUS|ICN|GMP|TAE|CJU|KWJ|RSU)-/i, '')
        .replace(/-(\d{4,})$/, (_m, digits: string) => `-${String(Number(digits)).padStart(2, '0')}`)
    : `YSN-${id.slice(0, 8).toUpperCase()}`;
  let candidate = normalized.toUpperCase();
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${normalized.toUpperCase()}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function addHighlight(out: string[], value: string | null | undefined): void {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length < 2) return;
  if (!out.includes(normalized)) out.push(normalized);
}

function buildHighlights(row: PackageRow): string[] {
  const out: string[] = [];
  const title = row.title ?? '';
  const typeText = `${row.product_type ?? ''} ${row.trip_style ?? ''} ${title}`;

  if (row.destination) addHighlight(out, `${row.destination} 중심 일정`);
  if (row.duration) addHighlight(out, `${row.duration}일 일정`);
  if (/노팁/i.test(typeText)) addHighlight(out, '노팁 구성');
  if (/노옵션/i.test(typeText)) addHighlight(out, '노옵션 구성');
  if (/노쇼핑/i.test(typeText)) addHighlight(out, '노쇼핑 구성');
  if (/품격|프리미엄|특급|5성/i.test(typeText)) addHighlight(out, '상급 숙박/품격형 구성');
  if (/실속|가성비|라이트|슬림/i.test(typeText)) addHighlight(out, '실속형 가격 구성');
  if (/자유|에어텔|호캉스/i.test(typeText)) addHighlight(out, '자유시간 포함 구성');
  if (row.airline) addHighlight(out, `${row.airline} 항공 이용`);
  if (Array.isArray(row.inclusions) && row.inclusions.length > 0) addHighlight(out, `포함사항 ${row.inclusions.length}개 등록`);
  if (row.price_dates) addHighlight(out, '출발일별 가격 등록');
  if (row.product_summary) addHighlight(out, row.product_summary.slice(0, 80));

  return out.slice(0, 5);
}

async function loadExistingShortCodes(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('short_code')
    .not('short_code', 'is', null);
  if (error) throw new Error(error.message);
  return new Set((data ?? [])
    .map((row) => String((row as { short_code?: string | null }).short_code ?? '').trim().toUpperCase())
    .filter(Boolean));
}

async function loadCandidates(limit: number): Promise<PackageRow[]> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,internal_code,short_code,country,product_highlights,product_summary,product_type,trip_style,airline,duration,nights,price_dates,inclusions,excludes')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PackageRow[];
}

function buildPatches(rows: PackageRow[], usedShortCodes: Set<string>): PatchRow[] {
  return rows.flatMap((row) => {
    const patch: PatchRow['patch'] = {};
    const country = inferCountry(`${row.destination ?? ''} ${row.title ?? ''} ${row.internal_code ?? ''}`);
    if (!row.country?.trim() && country) patch.country = country;
    if (!row.short_code?.trim()) patch.short_code = buildShortCode(row.internal_code, row.id, usedShortCodes);
    if (!Array.isArray(row.product_highlights) || row.product_highlights.length === 0) {
      const highlights = buildHighlights(row);
      if (highlights.length > 0) patch.product_highlights = highlights;
    }
    return Object.keys(patch).length > 0
      ? [{ id: row.id, title: row.title, destination: row.destination, patch }]
      : [];
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [rows, usedShortCodes] = await Promise.all([
    loadCandidates(options.limit),
    loadExistingShortCodes(),
  ]);
  const patches = buildPatches(rows, usedShortCodes);

  const summary = {
    candidates: patches.length,
    country: patches.filter((row) => row.patch.country).length,
    short_code: patches.filter((row) => row.patch.short_code).length,
    product_highlights: patches.filter((row) => row.patch.product_highlights).length,
  };

  if (!options.apply) {
    const payload = {
      ok: true,
      mode: 'dry-run',
      summary,
      sample: patches.slice(0, 20),
      nextCommand: 'npm run backfill:active-product-answerability -- --apply',
    };
    console.log(options.json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2));
    return;
  }

  let updated = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const row of patches) {
    const { error } = await supabaseAdmin
      .from('travel_packages')
      .update(row.patch)
      .eq('id', row.id)
      .eq('status', 'active');
    if (error) failed.push({ id: row.id, error: error.message });
    else updated += 1;
  }

  const payload = {
    ok: failed.length === 0,
    mode: 'apply',
    summary,
    updated,
    failed,
  };
  console.log(options.json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
