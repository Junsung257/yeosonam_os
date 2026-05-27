/**
 * 나트랑 b68b08fe — 사장님 원문 대조 발견 3건 fix.
 *   1. price_dates 7/18(금) 83.9만 → 87.9만 (원문 7/15~7/22 수목금 = 879)
 *   2. excludes "매너팁(약 $1~2/일)" → "매너팁" (원문 환각 제거)
 *   3. DAY 5 schedule "김해 국제공항 도착" 라인 → "06:20 / 김해 국제공항 도착" (시간 보강)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const PKG = 'b68b08fe-594f-41bf-8417-637f4a66678a';

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: pkg } = await supa.from('travel_packages').select('price_dates, excludes, notices_parsed, itinerary_data').eq('id', PKG).single();
  if (!pkg) { console.log('패키지 없음'); return; }

  // ─── Fix 1: price_dates 7/18 87.9만 ───────────
  type PriceRow = { date: string; note?: string; price: number; status: string; child_price: number | null };
  const prices = (pkg as { price_dates?: PriceRow[] }).price_dates ?? [];
  let priceFix = 0;
  for (const p of prices) {
    // 7/15~7/22 수목금 = 879000. 7/18(금)만 잘못 박힘. 차후 확장 위해 7/15~7/22 기간 수목금 모두 검증.
    if (p.date >= '2026-07-15' && p.date <= '2026-07-22') {
      const d = new Date(p.date + 'T00:00:00Z');
      const dow = d.getUTCDay();  // 0=일 1=월 2=화 3=수 4=목 5=금 6=토
      const expectedPrice = (dow >= 3 && dow <= 5) ? 879000 : (dow === 1 || dow === 2 ? 879000 : 839000);
      if (p.price !== expectedPrice) {
        console.log(`  price ${p.date} (DOW=${dow}): ${p.price} → ${expectedPrice}`);
        p.price = expectedPrice;
        priceFix++;
      }
    }
  }

  // ─── Fix 2: excludes "매너팁(약 $1~2/일)" → "매너팁" ───────────
  type ExcludeItem = string | { text?: string; label?: string };
  const excludes = (pkg as { excludes?: ExcludeItem[] }).excludes ?? [];
  let excludesFix = 0;
  const newExcludes = excludes.map((e) => {
    if (typeof e === 'string' && e.includes('매너팁') && e.includes('$1~2')) {
      excludesFix++;
      return e.replace(/\(약\s*\$1~2\/일\)/g, '').replace(/\s+/g, ' ').trim();
    }
    if (typeof e === 'object' && e !== null) {
      const text = e.text ?? e.label ?? '';
      if (text.includes('매너팁') && text.includes('$1~2')) {
        excludesFix++;
        const cleaned = text.replace(/\(약\s*\$1~2\/일\)/g, '').replace(/\s+/g, ' ').trim();
        return { ...e, ...(e.text != null ? { text: cleaned } : {}), ...(e.label != null ? { label: cleaned } : {}) };
      }
    }
    return e;
  });

  // notices_parsed 안에도 매너팁 환각 있을 수 있음
  const notices = (pkg as { notices_parsed?: Array<{ text?: string }> }).notices_parsed ?? [];
  let noticesFix = 0;
  const newNotices = notices.map((n) => {
    if (n.text && n.text.includes('매너팁') && n.text.includes('$1~2')) {
      noticesFix++;
      return { ...n, text: n.text.replace(/\(약\s*\$1~2\/일\)/g, '').replace(/\s+/g, ' ').trim() };
    }
    return n;
  });

  // ─── Fix 3: DAY 5 schedule "김해 국제공항 도착" → "06:20 / 김해 국제공항 도착" ───────────
  type ScheduleItem = { activity: string; type?: string; [k: string]: unknown };
  type DayItem = { day: number; schedule?: ScheduleItem[]; [k: string]: unknown };
  const itin = (pkg as { itinerary_data?: { days?: DayItem[] } }).itinerary_data ?? { days: [] };
  let scheduleFix = 0;
  const newDays = (itin.days ?? []).map((d) => {
    if (d.day !== 5) return d;
    const newSchedule = (d.schedule ?? []).map((s) => {
      if (s.activity === '김해 국제공항 도착' || (s.activity && s.activity.endsWith('김해 국제공항 도착') && !s.activity.includes('06:20'))) {
        scheduleFix++;
        return { ...s, activity: '06:20 / 김해 국제공항 도착', type: 'flight' };
      }
      return s;
    });
    return { ...d, schedule: newSchedule };
  });

  // UPDATE
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (priceFix > 0) updates.price_dates = prices;
  if (excludesFix > 0) updates.excludes = newExcludes;
  if (noticesFix > 0) updates.notices_parsed = newNotices;
  if (scheduleFix > 0) updates.itinerary_data = { ...itin, days: newDays };

  console.log(`\nFix 결과: price=${priceFix} excludes=${excludesFix} notices=${noticesFix} schedule=${scheduleFix}`);
  if (priceFix + excludesFix + noticesFix + scheduleFix === 0) { console.log('변경 없음'); return; }

  const { error } = await supa.from('travel_packages').update(updates).eq('id', PKG);
  if (error) { console.log('UPDATE 실패:', error.message); return; }
  console.log('✓ DB UPDATE 완료');

  // revalidate
  const { revalidatePackagePaths } = await import('../src/lib/revalidate-helper');
  const rev = await revalidatePackagePaths(PKG);
  console.log(`✓ revalidate: prod=${rev.prod.ok ? 'OK' : rev.prod.error} dev=${rev.dev.ok ? 'OK' : rev.dev.error}`);

  // 추가로 localhost:3000 revalidate (사장님 새 dev)
  try {
    const r = await fetch('http://localhost:3000/api/revalidate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [`/packages/${PKG}`, `/m/packages/${PKG}`], secret: process.env.REVALIDATE_SECRET }),
    });
    console.log(`✓ localhost:3000: ${r.status}`);
  } catch (e) { console.log(`localhost:3000 fail: ${(e as Error).message}`); }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
