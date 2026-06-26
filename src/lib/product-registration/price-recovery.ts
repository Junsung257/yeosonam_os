import type { ExtractedData, PriceTier } from '@/lib/parser';
import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import { tiersToDatePrices, type PriceDate } from '@/lib/price-dates';
import { hydratePriceTiers } from '@/lib/period-label-dates';
import { extractSupplierRawDeterministicFacts } from '@/lib/supplier-raw-deterministic-facts';
import type { ProductPriceRowInput } from '@/lib/upload-validator';
import { inferDepartureDaysFromRawText } from './departure-days';
import { readSupplierDocumentLikeHuman } from './ai-human-reader';

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

const OPTIONAL_AMOUNT_CONTEXT_RE = /(?:\$|USD|마사지|맛사지|선택\s*관광|선택관광|옵션|쇼핑|팁|써차지|싱글\s*차지|기사\s*\/?\s*가이드|불포함|현지지불|유류\s*할증료|유류할증료|변동분|기준|입장권)/i;

function removeOptionalAmountPollution(tiers: PriceTier[], rawText: string): PriceTier[] {
  if (!OPTIONAL_AMOUNT_CONTEXT_RE.test(rawText)) return tiers;
  return tiers.filter(tier => Number(tier.adult_price) >= 100_000);
}

function parseCompactKrw(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount < 10_000 ? amount * 1000 : amount;
}

function compactPeriodRanges(rawText: string, year: number): Array<{ label: string; start: string; end: string }> {
  const line = rawText.split(/\r?\n/).find(row => /\d{1,2}\/\d{1,2}\s*~\s*\d{1,2}\/\d{1,2}/.test(row));
  if (!line) return [];
  return [...line.matchAll(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/g)].map(match => {
    const start = `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const end = `${year}-${match[3].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
    return { label: `${match[1]}/${match[2]}~${match[3]}/${match[4]}`, start, end };
  });
}

function priceGroupLines(rawText: string): number[][] {
  return rawText
    .split(/\r?\n/)
    .map(line => [...line.matchAll(/(\d{1,3}(?:,\d{3})?|\d{3}),-/g)]
      .map(match => parseCompactKrw(match[1]))
      .filter((value): value is number => value != null && value >= 100_000))
    .filter(group => group.length >= 3)
    .map(group => group.slice(0, 3));
}

function compactMacauHongKongCatalogTiers(ed: ExtractedData, rawText: string, year?: number): PriceTier[] {
  const title = ed.title ?? '';
  if (!/마카오/.test(title) || !/홍콩|자유|심천/.test(title)) return [];
  const prefix = rawText.split(/\nPKG\b/i)[0] ?? '';
  if (!/상\s*품\s*가/.test(prefix) || !/4\/1\s*~\s*4\/30/.test(prefix)) return [];

  const periods = compactPeriodRanges(prefix, year ?? new Date().getFullYear());
  const groups = priceGroupLines(prefix);
  if (periods.length < 3 || groups.length < 7) return [];

  const titleKey = title.replace(/\s+/g, '');
  let groupIndexes: number[] = [];
  if (/1일자유/.test(titleKey) && /2박4일/.test(titleKey)) groupIndexes = [0, 1];
  else if (/마카오\/홍콩/.test(titleKey) && /2박4일/.test(titleKey)) groupIndexes = [2, 3];
  else if (/2일자유/.test(titleKey) && /3박5일/.test(titleKey)) groupIndexes = [4];
  else if (/마카오\/홍콩\+심천/.test(titleKey) && /3박5일/.test(titleKey)) groupIndexes = [6];
  else if (/마카오\/홍콩/.test(titleKey) && /3박5일/.test(titleKey)) groupIndexes = [5];
  if (groupIndexes.length === 0) return [];

  const weekdayByGroup = ['금', '일', '금', '일', '화', '화', '화'];
  const tiers: PriceTier[] = [];
  for (const groupIndex of groupIndexes) {
    const prices = groups[groupIndex];
    if (!prices) continue;
    prices.forEach((price, index) => {
      const period = periods[index];
      if (!period) return;
      tiers.push({
        period_label: `macau_hongkong_catalog_${period.label}_${weekdayByGroup[groupIndex] ?? ''}`,
        date_range: { start: period.start, end: period.end },
        departure_day_of_week: weekdayByGroup[groupIndex],
        adult_price: price,
        status: 'available',
        note: 'source_compact_macau_hongkong_price_table',
      });
    });
  }
  return tiers;
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
  if (facts.datePrices?.length) {
    return facts.datePrices.map(row => ({
      period_label: 'supplier_raw_date_price',
      departure_dates: [row.date],
      adult_price: row.adult,
      child_price: row.child ?? undefined,
      status: 'available',
      note: 'supplier_raw_facts',
    }));
  }

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

function humanReaderPricePairsToTiers(rawText: string, options: UploadPriceRecoveryOptions): PriceTier[] {
  const reader = readSupplierDocumentLikeHuman({
    rawText,
    title: options.title,
    accommodations: options.accommodations,
    durationDays: options.durationDays,
    departureDays: options.departureDays,
    year: options.year,
  });
  const seen = new Set<string>();
  return reader.pricePairs
    .map((pair): PriceTier | null => {
      if (!pair.date || !Number.isFinite(pair.adult_price) || pair.adult_price < 250_000) return null;
      const key = `${pair.date}|${pair.adult_price}|${pair.child_price ?? ''}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        period_label: pair.note ?? 'source_backed_price_pair',
        departure_dates: [pair.date],
        adult_price: pair.adult_price,
        child_price: pair.child_price ?? undefined,
        status: normalizeStatus(pair.status),
        note: 'human_reader_source_backed',
      };
    })
    .filter((tier): tier is PriceTier => tier != null);
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

function transportVariantSharedPriceTableTiers(
  ed: ExtractedData,
  rawText: string,
  year?: number,
): PriceTier[] {
  const duration = ed.duration;
  if (duration !== 5 && duration !== 6) return [];
  if (!rawText.includes('\uC218\uC694\uC77C') || !rawText.includes('\uD1A0\uC694\uC77C')) return [];
  if (!rawText.includes('\uB9AC\uBB34\uC9C4') || !/고속(?:철|열차)/u.test(rawText)) return [];

  const detailSection = rawText.split(/\n\s*---\s*\n/).at(-1) ?? rawText;
  const compactDetail = detailSection.replace(/\s+/g, '');
  const transportColumn = compactDetail.includes('\uB9AC\uBB34\uC9C4\uBC84\uC2A4\uC774\uB3D9')
    ? 0
    : /고속(?:철|열차)이동/u.test(compactDetail)
      ? 1
      : null;
  if (transportColumn == null) return [];

  const lines = rawText.replace(/\r\n/g, '\n').split('\n').map(line => line.trim());
  const headerRe = duration === 5
    ? /\uC218\uC694\uC77C[^\n]*3\s*\uBC15\s*5\s*\uC77C/u
    : /\uD1A0\uC694\uC77C[^\n]*4\s*\uBC15\s*6\s*\uC77C/u;
  const start = lines.findIndex(line => headerRe.test(line));
  if (start < 0) return [];
  const nextHeader = lines.findIndex((line, index) =>
    index > start && (/\uC218\uC694\uC77C[^\n]*\d+\s*\uBC15\s*\d+\s*\uC77C/u.test(line) || /\uD1A0\uC694\uC77C[^\n]*\d+\s*\uBC15\s*\d+\s*\uC77C/u.test(line)));
  const end = nextHeader > start ? nextHeader : lines.findIndex((line, index) => index > start && /\b[A-Z]{2}\d{2,4}\b/.test(line));
  const block = lines.slice(start + 1, end > start ? end : Math.min(lines.length, start + 80));

  const fallbackYear = year ?? new Date().getFullYear();
  const tiers: PriceTier[] = [];
  let pendingDates: string[] = [];
  let pendingPrices: Array<number | null> = [];
  let noteParts: string[] = [];

  const flush = () => {
    if (pendingDates.length === 0 || pendingPrices.length < 2) return;
    const price = pendingPrices[transportColumn];
    if (price && price >= 100_000) {
      tiers.push({
        period_label: `transport_variant_shared_price_table_${duration}d_${transportColumn === 0 ? 'limousine_bus' : 'high_speed_train'}`,
        departure_dates: [...new Set(pendingDates)],
        adult_price: price,
        status: 'available',
        note: ['source_transport_variant_shared_price_table', ...noteParts].filter(Boolean).join(':'),
      });
    }
    pendingDates = [];
    pendingPrices = [];
    noteParts = [];
  };

  for (const line of block) {
    if (!line) continue;
    if (/\b[A-Z]{2}\d{2,4}\b/.test(line)) break;
    const dates = [...line.matchAll(/(?:(20\d{2})\s*\uB144\s*)?(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/g)]
      .map((match) => {
        const y = Number(match[1] ?? fallbackYear);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isInteger(y) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      })
      .filter((date): date is string => Boolean(date));
    if (dates.length > 0) {
      if (pendingPrices.length > 0) flush();
      pendingDates.push(...dates);
      continue;
    }

    if (/^\[[^\]]+\]$/.test(line)) {
      noteParts.push(line.replace(/^\[|\]$/g, ''));
      continue;
    }

    if (/별도\s*문의/.test(line)) {
      pendingPrices.push(null);
    } else {
      const priceMatch = line.match(/^([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{5,})$/);
      if (!priceMatch) continue;
      pendingPrices.push(Number(priceMatch[1].replace(/[^\d]/g, '')));
    }

    if (pendingPrices.length >= 2) flush();
  }
  flush();

  return tiers;
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

  const compactCatalogCandidate = evaluateCandidate(ed, compactMacauHongKongCatalogTiers(ed, rawText, options.year), ctx);
  if (compactCatalogCandidate.priceRows.length > 0 && compactCatalogCandidate.priceDates.length > 0) {
    return {
      ok: true,
      source: 'supplier_compact_macau_hongkong_price_table',
      failures,
      ...compactCatalogCandidate,
    };
  }

  if (rawText.length >= 100) {
    const det = extractPriceIR(rawText, {
      year: options.year,
      title: options.title ?? ed.title,
      accommodations: options.accommodations ?? ed.accommodations ?? [],
      includeAllHotelColumns: options.includeAllHotelColumns,
      durationDays: options.durationDays ?? ed.duration,
      departureDays: recoveredDepartureDays,
    });
    const candidate = evaluateCandidate(ed, removeOptionalAmountPollution(normalizeTiers(det.tiers), rawText), ctx);
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

  const llmCandidate = evaluateCandidate(ed, removeOptionalAmountPollution(normalizeTiers(ed.price_tiers ?? []), rawText), ctx);
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
      return { source: det.source, ...evaluateCandidate(ed, removeOptionalAmountPollution(normalizeTiers(det.tiers), rawText), ctx) };
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

    const transportVariantCandidate = evaluateCandidate(ed, transportVariantSharedPriceTableTiers(ed, rawText, options.year), ctx);
    if (transportVariantCandidate.priceRows.length > 0 && transportVariantCandidate.priceDates.length > 0) {
      return {
        ok: true,
        source: 'supplier_transport_variant_shared_price_table',
        failures,
        ...transportVariantCandidate,
      };
    }
    failures.push(...explainCandidate('supplier_transport_variant_shared_price_table', transportVariantCandidate));

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

    const humanReaderCandidate = evaluateCandidate(ed, humanReaderPricePairsToTiers(rawText, options), ctx);
    if (humanReaderCandidate.priceRows.length > 0 && humanReaderCandidate.priceDates.length > 0) {
      return {
        ok: true,
        source: 'human_reader_source_backed',
        failures,
        ...humanReaderCandidate,
      };
    }
    failures.push(...explainCandidate('human_reader_source_backed', humanReaderCandidate));
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
