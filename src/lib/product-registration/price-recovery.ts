import type { ExtractedData, PriceTier } from '@/lib/parser';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import { tiersToDatePrices, type PriceDate } from '@/lib/price-dates';
import { hydratePriceTiers } from '@/lib/period-label-dates';
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
  includeAllHotelColumns?: boolean;
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

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function hasUsableDateSource(tier: Record<string, unknown>): boolean {
  if (Array.isArray(tier.departure_dates) && tier.departure_dates.some(isDateString)) return true;
  const dateRange = tier.date_range;
  if (
    dateRange
    && typeof dateRange === 'object'
    && isDateString((dateRange as { start?: unknown }).start)
    && isDateString((dateRange as { end?: unknown }).end)
  ) {
    return true;
  }
  return typeof tier.departure_day_of_week === 'string' && tier.departure_day_of_week.trim().length > 0;
}

export function normalizeStrictFallbackPriceTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return [];
  const candidates = raw.filter((tier): tier is Record<string, unknown> => {
    if (!tier || typeof tier !== 'object') return false;
    const adultPrice = typeof tier.adult_price === 'number' ? tier.adult_price : Number(tier.adult_price);
    return Number.isInteger(adultPrice)
      && adultPrice >= 10_000
      && adultPrice <= 50_000_000
      && hasUsableDateSource(tier);
  });
  return normalizeTiers(candidates);
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

function groupedDeparturePriceTiers(rawText: string, year?: number): PriceTier[] {
  const dateBlock = rawText.match(/출\s*발\s*(?:날짜|일자|일)([\s\S]{0,300}?)(?:출발인원|상\s*품\s*가|상품가|판매가)/)?.[1] ?? '';
  const priceBlock = rawText.match(/(?:상\s*품\s*가|상품가|판매가)([\s\S]{0,160}?)(?:룸\s*타\s*입|룸타입|포\s*함|포함|불\s*포\s*함|불포함)/)?.[1] ?? '';
  if (!dateBlock || !priceBlock) return [];

  const fallbackYear = year ?? new Date().getFullYear();
  const dateMatches = [...dateBlock.matchAll(/(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)];
  const dates = dateMatches
    .map((match) => {
      const y = Number(match[1] ?? fallbackYear);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!Number.isInteger(y) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    })
    .filter((date): date is string => Boolean(date));
  const prices = [...priceBlock.matchAll(/([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{4,})\s*(?:원|\/\s*인|\/인)?/g)]
    .map(match => Number(match[1].replace(/[^\d]/g, '')))
    .filter(price => Number.isFinite(price) && price >= 10_000);

  if (dates.length === 0 || prices.length === 0) return [];
  if (prices.length === 1) {
    return [{
      period_label: 'grouped_departure_price_table',
      departure_dates: [...new Set(dates)],
      adult_price: prices[0],
      status: 'available',
      note: 'source_grouped_departure_price',
    }];
  }

  const groupSize = Math.ceil(dates.length / prices.length);
  return prices
    .map((price, index): PriceTier | null => {
      const departure_dates = dates.slice(index * groupSize, (index + 1) * groupSize);
      if (departure_dates.length === 0) return null;
      return {
        period_label: `grouped_departure_price_table_${index + 1}`,
        departure_dates,
        adult_price: price,
        status: 'available',
        note: 'source_grouped_departure_price',
      };
    })
    .filter((tier): tier is PriceTier => tier != null);
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

async function extractPriceTiersWithAiGateway(rawText: string): Promise<{
  tiers: PriceTier[];
  provider: string | null;
  errors: string[];
}> {
  const { llmCall } = await import('@/lib/llm-gateway');
  const result = await llmCall<{ price_tiers?: unknown }>({
    task: 'parse_travel_doc',
    systemPrompt: [
      'You extract only customer package prices from Korean travel product source text.',
      'Return strict JSON with price_tiers only.',
      'Do not include optional tours, entrance tickets, tips, visa, fuel surcharge, hotel single charge, or shopping amounts as product prices.',
      'Each tier must include adult_price as a KRW integer and at least one usable date source.',
    ].join('\n'),
    userPrompt: [
      '다음 여행상품 원문에서 상품가 가격표만 추출하세요.',
      '선택관광, 입장권, 팁, 비자, 유류할증료, 독실료, 쇼핑 금액은 상품가로 넣지 마세요.',
      '반드시 JSON object 형식으로만 답하세요.',
      '',
      '응답 형식:',
      '{ "price_tiers": [{ "period_label": "...", "departure_dates": ["2026-05-27"], "adult_price": 1059000, "status": "available" }] }',
      '',
      '원문:',
      '---',
      rawText.slice(0, 6000),
      '---',
    ].join('\n'),
    jsonSchema: {
      type: 'object',
      properties: {
        price_tiers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              period_label: { type: 'string' },
              departure_dates: { type: 'array', items: { type: 'string' } },
              departure_day_of_week: { type: 'string' },
              adult_price: { type: 'number' },
              child_price: { type: 'number' },
              status: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
      },
      required: ['price_tiers'],
    },
    temperature: 0,
    maxTokens: 1200,
    maxRetries: 1,
    autoEscalate: false,
  });

  if (!result.success) {
    return {
      tiers: [],
      provider: result.provider ?? null,
      errors: result.errors ?? ['unknown ai gateway failure'],
    };
  }

  return {
    tiers: normalizeStrictFallbackPriceTiers(result.data?.price_tiers),
    provider: result.provider ?? null,
    errors: [],
  };
}

export async function recoverUploadPriceData(
  ed: ExtractedData,
  options: UploadPriceRecoveryOptions = {},
): Promise<UploadPriceRecoveryResult> {
  const failures: string[] = [];
  const rawText = options.rawText ?? ed.rawText ?? '';
  const recoveredDepartureDays = options.departureDays ?? ed.departure_days ?? inferDepartureDaysFromRawText(rawText);
  const ctx = { packageDepartureDays: recoveredDepartureDays, year: options.year };
  let deterministicCandidate: (Pick<UploadPriceRecoveryResult, 'tiers' | 'priceRows' | 'priceDates' | 'minPrice'> & { source: string }) | null = null;

  if (rawText.length >= 100) {
    const det = extractPriceIR(rawText, {
      year: options.year,
      title: options.title ?? ed.title,
      accommodations: options.accommodations ?? ed.accommodations ?? [],
      includeAllHotelColumns: options.includeAllHotelColumns,
      durationDays: options.durationDays ?? ed.duration,
      departureDays: recoveredDepartureDays,
    });
    const candidate = evaluateCandidate(ed, normalizeTiers(det.tiers), ctx);
    deterministicCandidate = { source: det.source, ...candidate };

    if (det.source !== 'none' && candidate.priceRows.length > 0 && candidate.priceDates.length > 0) {
      return {
        ok: true,
        source: `deterministic:${det.source}`,
        failures,
        ...candidate,
      };
    }
  }

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
    const detCandidate = deterministicCandidate ?? (() => {
      const det = extractPriceIR(rawText, {
        year: options.year,
        title: options.title ?? ed.title,
        accommodations: options.accommodations ?? ed.accommodations ?? [],
        includeAllHotelColumns: options.includeAllHotelColumns,
        durationDays: options.durationDays ?? ed.duration,
        departureDays: recoveredDepartureDays,
      });
      return { source: det.source, ...evaluateCandidate(ed, normalizeTiers(det.tiers), ctx) };
    })();
    if (detCandidate.priceRows.length > 0 && detCandidate.priceDates.length > 0) {
      const { source: detSource, ...candidate } = detCandidate;
      return {
        ok: true,
        source: `deterministic:${detSource}`,
        failures,
        ...candidate,
      };
    }
    failures.push(...explainCandidate(`deterministic:${detCandidate.source}`, detCandidate));

    const groupedCandidate = evaluateCandidate(ed, groupedDeparturePriceTiers(rawText, options.year), ctx);
    if (groupedCandidate.priceRows.length > 0 && groupedCandidate.priceDates.length > 0) {
      return {
        ok: true,
        source: 'supplier_grouped_departure_price_table',
        failures,
        ...groupedCandidate,
      };
    }
    failures.push(...explainCandidate('supplier_grouped_departure_price_table', groupedCandidate));

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
      const aiFallback = await extractPriceTiersWithAiGateway(rawText);
      const aiCandidate = evaluateCandidate(ed, aiFallback.tiers, ctx);
      const aiPrefix = aiFallback.provider ? `ai_fallback:${aiFallback.provider}` : 'ai_fallback';
      if (aiCandidate.priceRows.length > 0 && aiCandidate.priceDates.length > 0) {
        return {
          ok: true,
          source: aiPrefix,
          failures,
          ...aiCandidate,
        };
      }
      failures.push(...aiFallback.errors.map(error => `${aiPrefix}:실패:${error}`));
      failures.push(...explainCandidate(aiPrefix, aiCandidate));
    } catch (e) {
      failures.push(`ai_fallback:실패:${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    failures.push('ai_fallback:비활성 또는 원문 길이 부족');
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
