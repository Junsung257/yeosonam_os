import type { ExtractedData, PriceTier } from '@/lib/parser';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import { tiersToDatePrices, type PriceDate } from '@/lib/price-dates';
import { hydratePriceTiers } from '@/lib/period-label-dates';
import { getSecret } from '@/lib/secret-registry';
import { extractSupplierRawDeterministicFacts } from '@/lib/supplier-raw-deterministic-facts';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import { inferDepartureDaysFromRawText } from './departure-days';

export type UploadPriceRecoveryResult = {
  ok: boolean;
  source: string;
  tiers: PriceTier[];
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
  minPrice: number | null;
  failures: string[];
};

export type UploadPriceRecoveryOptions = {
  rawText?: string | null;
  title?: string | null;
  accommodations?: string[] | null;
  durationDays?: number | null;
  departureDays?: string | null;
  year?: number;
  enableGeminiFallback?: boolean;
};

function minPriceFromTiers(tiers: Array<{ adult_price?: number | null }> | null | undefined): number | null {
  const prices = (tiers ?? [])
    .map(tier => tier.adult_price)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function priceDatesToRows(priceDates: PriceDate[]): ProductPriceRowInput[] {
  return priceDates.map((row) => ({
    target_date: row.date,
    day_of_week: null,
    net_price: row.price,
    adult_selling_price: null,
    child_price: row.child_price ?? null,
    note: row.confirmed ? 'confirmed' : null,
  }));
}

function tiersToProductPriceRows(tiers: PriceTier[]): ProductPriceRowInput[] {
  const rows: ProductPriceRowInput[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    if (tier.status === 'soldout') continue;
    const netPrice = tier.adult_price;
    if (!Number.isFinite(netPrice) || !netPrice || netPrice <= 0) continue;
    const note = tier.note ?? tier.period_label ?? null;
    for (const date of tier.departure_dates ?? []) {
      if (!date) continue;
      const key = `${date}|${netPrice}|${note ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        target_date: date,
        day_of_week: null,
        net_price: netPrice,
        adult_selling_price: null,
        child_price: tier.child_price ?? null,
        note,
      });
    }
  }
  return rows.sort((a, b) => {
    const dateCompare = String(a.target_date ?? '').localeCompare(String(b.target_date ?? ''));
    if (dateCompare !== 0) return dateCompare;
    return a.net_price - b.net_price;
  });
}

function productPriceRowsToMinPriceDates(rows: ProductPriceRowInput[], tiers: PriceTier[]): PriceDate[] {
  const confirmedDates = new Set<string>();
  for (const tier of tiers) {
    const confirmed = tier.status === 'confirmed' || !!(tier.note && /출확|출발확정/.test(tier.note));
    if (!confirmed) continue;
    for (const date of tier.departure_dates ?? []) confirmedDates.add(date);
  }

  const byDate = new Map<string, ProductPriceRowInput>();
  for (const row of rows) {
    if (!row.target_date || !Number.isFinite(row.net_price) || row.net_price <= 0) continue;
    const current = byDate.get(row.target_date);
    if (!current || row.net_price < current.net_price) byDate.set(row.target_date, row);
  }

  return [...byDate.entries()]
    .map(([date, row]) => ({
      date,
      price: row.net_price,
      ...(row.child_price ? { child_price: row.child_price } : {}),
      confirmed: confirmedDates.has(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeStatus(status: unknown): PriceTier['status'] {
  if (status === 'confirmed' || status === 'soldout') return status;
  return 'available';
}

function normalizeTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tier): PriceTier | null => {
      if (!tier || typeof tier !== 'object') return null;
      const t = tier as Partial<PriceTier> & { status?: unknown };
      const adultPrice = typeof t.adult_price === 'number' ? t.adult_price : Number(t.adult_price ?? 0);
      if (!Number.isFinite(adultPrice) || adultPrice <= 0) return null;
      return {
        period_label: typeof t.period_label === 'string' ? t.period_label : '',
        departure_dates: Array.isArray(t.departure_dates) ? t.departure_dates.filter((v): v is string => typeof v === 'string') : [],
        date_range: t.date_range?.start && t.date_range?.end ? { start: t.date_range.start, end: t.date_range.end } : undefined,
        departure_day_of_week: typeof t.departure_day_of_week === 'string' ? t.departure_day_of_week : undefined,
        excluded_dates: Array.isArray(t.excluded_dates) ? t.excluded_dates.filter((v): v is string => typeof v === 'string') : undefined,
        adult_price: adultPrice,
        child_price: typeof t.child_price === 'number' ? t.child_price : undefined,
        infant_price: typeof t.infant_price === 'number' ? t.infant_price : undefined,
        status: normalizeStatus(t.status),
        note: typeof t.note === 'string' ? t.note : undefined,
      };
    })
    .filter((tier): tier is PriceTier => tier != null);
}

function supplierRawFactsToTiers(rawText: string): PriceTier[] {
  const facts = extractSupplierRawDeterministicFacts(rawText);
  const adultPrice = facts.prices.adult;
  if (!adultPrice || facts.dates.length === 0) return [];

  return [{
    period_label: 'supplier_raw_departure_dates',
    departure_dates: [...new Set(facts.dates)],
    adult_price: adultPrice,
    child_price: facts.prices.child ?? undefined,
    status: 'available',
    note: 'supplier_raw_facts',
  }];
}

function evaluateCandidate(
  ed: ExtractedData,
  tiers: PriceTier[],
  ctx: { packageDepartureDays?: string | null; year?: number },
): Pick<UploadPriceRecoveryResult, 'tiers' | 'priceRows' | 'priceDates' | 'minPrice'> {
  const hydrated = normalizeTiers(hydratePriceTiers(tiers, {
    year: ctx.year,
    packageDepartureDays: ctx.packageDepartureDays ?? undefined,
  }));
  const priceDates = tiersToDatePrices(hydrated, {
    year: ctx.year,
    packageDepartureDays: ctx.packageDepartureDays ?? undefined,
  });
  const priceRows = tiersToProductPriceRows(hydrated);
  return {
    tiers: hydrated,
    priceRows: priceRows.length > 0 ? priceRows : priceDatesToRows(priceDates),
    priceDates: priceRows.length > 0 ? productPriceRowsToMinPriceDates(priceRows, hydrated) : priceDates,
    minPrice: minPriceFromTiers(hydrated),
  };
}

function explainCandidate(prefix: string, candidate: Pick<UploadPriceRecoveryResult, 'tiers' | 'priceRows' | 'priceDates'>): string[] {
  const failures: string[] = [];
  if (candidate.tiers.length === 0) failures.push(`${prefix}:price_tiers 없음`);
  if (candidate.priceRows.length === 0) failures.push(`${prefix}:product_prices 없음`);
  if (candidate.priceDates.length === 0) failures.push(`${prefix}:price_dates 없음`);
  return failures;
}

async function extractPriceTiersWithGemini(rawText: string): Promise<PriceTier[]> {
  const geminiKey = getSecret('GOOGLE_AI_API_KEY');
  if (!geminiKey) return [];

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  });
  const prompt = `다음 여행상품 원문에서 상품가 가격표만 price_tiers로 추출하세요.
선택관광, 입장권, 팁, 써차지 단독 금액은 상품가로 넣지 마세요.
각 tier는 adult_price(원화 정수), departure_dates(YYYY-MM-DD 배열), departure_day_of_week(optional), period_label을 포함합니다.

원문:
---
${rawText.slice(0, 6000)}
---

JSON 배열로만 응답:
[{ "period_label": "...", "departure_dates": ["2026-05-27"], "adult_price": 1059000 }]`;

  const res = await model.generateContent(prompt);
  const txt = res.response.text();
  const jsonMatch = txt.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  return normalizeTiers(JSON.parse(jsonMatch[0]));
}

export async function recoverUploadPriceData(
  ed: ExtractedData,
  options: UploadPriceRecoveryOptions = {},
): Promise<UploadPriceRecoveryResult> {
  const failures: string[] = [];
  const rawText = options.rawText ?? ed.rawText ?? '';
  const recoveredDepartureDays = options.departureDays ?? ed.departure_days ?? inferDepartureDaysFromRawText(rawText);
  const ctx = { packageDepartureDays: recoveredDepartureDays, year: options.year };

  const llmCandidate = evaluateCandidate(ed, normalizeTiers(ed.price_tiers ?? []), ctx);
  if (llmCandidate.priceRows.length > 0 && llmCandidate.priceDates.length > 0) {
    return {
      ok: true,
      source: 'llm_hydrated',
      failures,
      ...llmCandidate,
    };
  }
  failures.push(...explainCandidate('llm', llmCandidate));

  if (rawText.length >= 100) {
    const det = extractPriceIR(rawText, {
      year: options.year,
      title: options.title ?? ed.title,
      accommodations: options.accommodations ?? ed.accommodations ?? [],
      durationDays: options.durationDays ?? ed.duration,
      departureDays: recoveredDepartureDays,
    });
    const detCandidate = evaluateCandidate(ed, normalizeTiers(det.tiers), ctx);
    if (detCandidate.priceRows.length > 0 && detCandidate.priceDates.length > 0) {
      return {
        ok: true,
        source: `deterministic:${det.source}`,
        failures,
        ...detCandidate,
      };
    }
    failures.push(...explainCandidate(`deterministic:${det.source}`, detCandidate));

    const supplierRawCandidate = evaluateCandidate(ed, supplierRawFactsToTiers(rawText), ctx);
    if (supplierRawCandidate.priceRows.length > 0 && supplierRawCandidate.priceDates.length > 0) {
      return {
        ok: true,
        source: 'supplier_raw_facts',
        failures,
        ...supplierRawCandidate,
      };
    }
    failures.push(...explainCandidate('supplier_raw_facts', supplierRawCandidate));
  } else {
    failures.push('deterministic:원문 길이 부족');
  }

  if (options.enableGeminiFallback && rawText.length >= 100) {
    try {
      const geminiTiers = await extractPriceTiersWithGemini(rawText);
      const geminiCandidate = evaluateCandidate(ed, geminiTiers, ctx);
      if (geminiCandidate.priceRows.length > 0 && geminiCandidate.priceDates.length > 0) {
        return {
          ok: true,
          source: 'gemini',
          failures,
          ...geminiCandidate,
        };
      }
      failures.push(...explainCandidate('gemini', geminiCandidate));
    } catch (e) {
      failures.push(`gemini:실패:${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    failures.push('gemini:비활성 또는 원문 길이 부족');
  }

  return {
    ok: false,
    source: 'none',
    tiers: llmCandidate.tiers,
    priceRows: llmCandidate.priceRows,
    priceDates: llmCandidate.priceDates,
    minPrice: llmCandidate.minPrice,
    failures: [...new Set(failures)],
  };
}
