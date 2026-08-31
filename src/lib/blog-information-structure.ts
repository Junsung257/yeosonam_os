import { stripMarkup } from './blog-text-utils';
import type { BlogInformationIntent } from './blog-information-contract';

export interface BlogInformationTable {
  headers: string[];
  rows: string[][];
}

export interface BlogInformationStructureReport {
  passed: boolean;
  issues: string[];
  tableCount: number;
  meaningfulRowCount: number;
  uniqueNumericValueCount: number;
}

const EMPTY_VALUE_RE = /^(?:-|—|–|n\/?a|없음|미정|확인 필요|tbd|값|내용|예시)$/i;
const URL_RE = /https:\/\/[^\s)<>]+/i;
const DATE_RE = /(?:20\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?|20\d{2}년\s*\d{1,2}월(?:\s*\d{1,2}일)?|확인일|기준일|조사일)/i;
const CURRENCY_RE = /(?:KRW|JPY|USD|VND|SGD|CNY|EUR|THB|원|엔|달러|동|싱가포르달러|위안|유로|바트)/i;
const NUMBER_RE = /-?\d+(?:[,.]\d+)*/g;
const TIME_RE = /(?:[01]?\d|2[0-3]):[0-5]\d|\d+(?:\.\d+)?\s*(?:분|시간)/i;
const PRICE_RE = /(?:KRW|JPY|USD|VND|SGD|CNY|EUR|THB|₩|¥|\$|€)?\s*\d[\d,.]*(?:\s*(?:원|엔|달러|동|위안|유로|바트))?/i;

function clean(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(clean);
}

export function parseBlogInformationTables(markdown: string): BlogInformationTable[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const tables: BlogInformationTable[] = [];
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!/^\s*\|.+\|\s*$/.test(lines[index] ?? '')) continue;
    if (!/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(lines[index + 1] ?? '')) continue;
    const headers = splitRow(lines[index]);
    const rows: string[][] = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && /^\s*\|.+\|\s*$/.test(lines[rowIndex] ?? '')) {
      if (/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(lines[rowIndex] ?? '')) break;
      if (/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(lines[rowIndex + 1] ?? '')) break;
      const row = splitRow(lines[rowIndex]);
      if (row.length === headers.length) rows.push(row);
      rowIndex += 1;
    }
    tables.push({ headers, rows });
    index = rowIndex - 1;
  }
  return tables;
}

function meaningful(value: string): boolean {
  const normalized = clean(value);
  return normalized.length >= 1 && !EMPTY_VALUE_RE.test(normalized);
}

function rowText(row: string[]): string {
  return row.join(' ');
}

function matchingTables(tables: BlogInformationTable[], headerPattern: RegExp): BlogInformationTable[] {
  return tables.filter((table) => headerPattern.test(table.headers.join(' ')));
}

function rowsFrom(tables: BlogInformationTable[], headerPattern: RegExp): string[][] {
  return matchingTables(tables, headerPattern).flatMap((table) => table.rows)
    .filter((row) => row.every(meaningful));
}

function distinctFirstCells(rows: string[][]): string[] {
  return [...new Set(rows.map((row) => clean(row[0]).toLowerCase()).filter((value) => value.length >= 2))];
}

function numericValues(markdown: string): string[] {
  return [...new Set((markdown.match(NUMBER_RE) ?? [])
    .map((value) => value.replace(/,/g, ''))
    .filter((value) => !/^20\d{2}$/.test(value)))];
}

function add(issues: string[], condition: boolean, code: string): void {
  if (!condition) issues.push(code);
}

function hasRowsWith(rows: string[][], count: number, patterns: RegExp[]): boolean {
  const matched = rows.filter((row) => patterns.every((pattern) => pattern.test(rowText(row))));
  return distinctFirstCells(matched).length >= count;
}

function hasFoodBudgetTierRows(tables: BlogInformationTable[]): boolean {
  const tierTables = matchingTables(tables, /유형|예산|하루|1일|총액/i);
  const tierRows = tierTables.flatMap((table) => {
    const currencyDeclaredInHeader = CURRENCY_RE.test(table.headers.join(' '));
    return table.rows.filter((row) => {
      if (!row.every(meaningful)) return false;
      const text = rowText(row);
      return PRICE_RE.test(text) || (currencyDeclaredInHeader && /\d+(?:[,.]\d+)*/.test(text));
    });
  });
  const labels = tierRows.map((row) => clean(row[0] ?? ''));
  return ['절약', '일반', '여유'].every((tier) => labels.some((label) => label.includes(tier)));
}

function validateFood(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const meals = rowsFrom(tables, /끼니|식사|메뉴|가격/i);
  add(issues, CURRENCY_RE.test(markdown), 'food_budget:currency_required');
  add(issues, DATE_RE.test(markdown), 'food_budget:research_date_required');
  add(issues, /절약/.test(markdown) && /일반/.test(markdown) && /여유/.test(markdown), 'food_budget:three_tiers_required');
  add(issues, hasFoodBudgetTierRows(tables), 'food_budget:daily_tier_rows_required');
  for (const meal of ['아침', '점심', '저녁', '간식']) {
    add(issues, meals.some((row) => rowText(row).includes(meal) && PRICE_RE.test(rowText(row))), `food_budget:${meal}_value_required`);
  }
  add(issues, meals.filter((row) => PRICE_RE.test(rowText(row))).length >= 4, 'food_budget:representative_menu_prices_required');
  add(issues, /(?:여행|\d+박\s*\d+일).{0,30}총액|총액.{0,30}(?:여행|\d+박\s*\d+일)/s.test(markdown), 'food_budget:trip_total_required');
  add(issues, URL_RE.test(markdown), 'food_budget:evidence_required');
}

function validateWeather(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /월|기간|최고|최저|기온|강수|옷차림/i);
  const months = [...new Set(rows.map((row) => rowText(row).match(/(?:^|\s)(1[0-2]|[1-9])월/)?.[1]).filter(Boolean))];
  add(issues, months.length >= 12 || (months.length >= 3 && /요청 범위|여행 기간/.test(markdown)), 'monthly_weather:month_rows_required');
  add(issues, rows.filter((row) => /-?\d+(?:\.\d+)?\s*(?:℃|°C)/i.test(rowText(row))).length >= Math.min(months.length, 3), 'monthly_weather:temperature_values_required');
  add(issues, rows.filter((row) => /\d+(?:\.\d+)?\s*(?:mm|일|%)/.test(rowText(row))).length >= Math.min(months.length, 3), 'monthly_weather:precipitation_values_required');
  add(issues, rows.filter((row) => /옷|재킷|코트|반팔|긴팔|우산|방수/.test(rowText(row))).length >= Math.min(months.length, 3), 'monthly_weather:clothing_values_required');
  add(issues, /관측\s*기간|평년|20\d{2}\s*[~-]\s*20\d{2}/.test(markdown), 'monthly_weather:observation_period_required');
  add(issues, URL_RE.test(markdown), 'monthly_weather:source_required');
}

function validateAirport(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const tableRows = rowsFrom(tables, /수단|교통|요금|가격|소요|첫차|막차|운영/i);
  const listRows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .map((line) => [line]);
  const rows = tableRows.length > 0 ? tableRows : listRows;
  const modeKeys = new Set(rows.flatMap((row) => {
    const text = rowText(row);
    return [
      ...(/GRTA|버스|대중교통/i.test(text) ? ['public_transit'] : []),
      ...(/택시|카카오\s*T/i.test(text) ? ['taxi'] : []),
      ...(/렌터카|렌트카/i.test(text) ? ['rental_car'] : []),
      ...(/셔틀|픽업/i.test(text) ? ['shuttle'] : []),
    ];
  }));
  add(issues, modeKeys.size >= 2, 'airport_transport:multiple_modes_required');
  add(issues, rows.filter((row) => PRICE_RE.test(rowText(row))).length >= 2, 'airport_transport:prices_required');
  add(issues, rows.filter((row) => TIME_RE.test(rowText(row))).length >= 2, 'airport_transport:durations_required');
  add(issues, rows.filter((row) => /첫차|첫\s*운행|막차|운영\s*시간|24시간|\d{1,2}:\d{2}/.test(rowText(row))).length >= 2, 'airport_transport:operating_hours_required');
  add(issues, /수하물|짐/.test(markdown) && /심야|야간|늦은/.test(markdown), 'airport_transport:luggage_late_conditions_required');
  add(issues, URL_RE.test(markdown), 'airport_transport:evidence_required');
}

function validateLocalTransport(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /노선|구간|교통|수단|요금|가격|소요|배차|운행|예약/i);
  add(issues, distinctFirstCells(rows).length >= 2, 'local_transport:multiple_routes_or_modes_required');
  add(issues, rows.filter((row) => PRICE_RE.test(rowText(row))).length >= 2, 'local_transport:prices_required');
  add(issues, rows.filter((row) => TIME_RE.test(rowText(row))).length >= 2, 'local_transport:durations_or_frequency_required');
  add(
    issues,
    rows.filter((row) => /첫차|막차|운행\s*시간|운영\s*시간|배차|간격|시간표|\d{1,2}:\d{2}/.test(rowText(row))).length >= 2,
    'local_transport:schedule_required',
  );
  add(issues, /승차권|티켓|패스/.test(markdown) && /구매|예약/.test(markdown), 'local_transport:ticket_or_reservation_required');
  add(issues, /계절|성수기|운휴|예약|제한|변경/.test(markdown), 'local_transport:service_limits_required');
  add(issues, URL_RE.test(markdown) && /공식|운영사|정부|국립공원/.test(markdown), 'local_transport:official_evidence_required');
}

function validateHotel(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /지역|숙소|1박|가격|장점|단점|접근|대상/i);
  add(issues, distinctFirstCells(rows).length >= 3, 'hotel_areas:real_area_rows_required');
  add(issues, rows.filter((row) => PRICE_RE.test(rowText(row))).length >= 3, 'hotel_areas:price_ranges_required');
  add(issues, rows.filter((row) => /장점|편리|가깝|조용|단점|혼잡|비싸|멀/.test(rowText(row))).length >= 3, 'hotel_areas:pros_cons_required');
  add(issues, rows.filter((row) => /역|공항|도보|분|접근/.test(rowText(row))).length >= 3, 'hotel_areas:access_required');
  add(issues, rows.filter((row) => /가족|커플|혼자|여행자|추천/.test(rowText(row))).length >= 3, 'hotel_areas:traveler_fit_required');
}

function validateFamilyBudget(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /항목|예산|비용|금액|총액/i);
  add(issues, /성인\s*\d+|아동\s*\d+|아이\s*\d+/.test(markdown), 'family_budget:party_composition_required');
  add(issues, /\d+박\s*\d+일|\d+일\s*(?:여행|일정)/.test(markdown), 'family_budget:duration_required');
  for (const category of ['항공', '숙소', '식비', '교통']) {
    add(issues, rows.some((row) => rowText(row).includes(category) && PRICE_RE.test(rowText(row))), `family_budget:${category}_required`);
  }
  add(issues, rows.some((row) => /총액|합계/.test(rowText(row)) && PRICE_RE.test(rowText(row))), 'family_budget:total_required');
  add(issues, CURRENCY_RE.test(markdown) && DATE_RE.test(markdown), 'family_budget:currency_date_required');
}

function validateItinerary(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /일차|날짜|장소|시간|이동|예약|휴무/i);
  const days = [...new Set(rows.map((row) => rowText(row).match(/(\d+)일\s*차/)?.[1]).filter(Boolean))];
  add(issues, days.length >= 2, 'itinerary:day_rows_required');
  add(issues, rows.filter((row) => /[가-힣A-Za-z]{2,}/.test(row[1] ?? '')).length >= 2, 'itinerary:place_entities_required');
  add(issues, rows.filter((row) => /도보|버스|택시|열차|지하철|이동/.test(rowText(row))).length >= 2, 'itinerary:movement_required');
  add(issues, rows.filter((row) => TIME_RE.test(rowText(row))).length >= 2, 'itinerary:realistic_time_required');
  add(issues, /휴무|예약|운영\s*시간|입장\s*마감/.test(markdown), 'itinerary:closure_reservation_required');
}

function validateShopping(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /품목|기념품|선물|가격|구매|지역|매장/i);
  add(issues, distinctFirstCells(rows).length >= 3, 'shopping_souvenirs:item_rows_required');
  add(issues, rows.filter((row) => PRICE_RE.test(rowText(row))).length >= 3, 'shopping_souvenirs:prices_required');
  add(issues, rows.filter((row) => /지역|시장|백화점|역|공항|매장|거리/.test(rowText(row))).length >= 3, 'shopping_souvenirs:purchase_areas_required');
  if (/반입|면세|세관|금지/.test(markdown)) {
    add(issues, URL_RE.test(markdown) && /공식|세관|정부|관세청/.test(markdown), 'shopping_souvenirs:official_customs_evidence_required');
  }
}

function validateCurrency(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /결제|수단|현금|카드|모바일|수수료|조건/i);
  add(issues, CURRENCY_RE.test(markdown), 'currency_payment:currency_required');
  add(issues, distinctFirstCells(rows).length >= 2, 'currency_payment:payment_methods_required');
  add(issues, /수수료/.test(markdown) && /현금|카드|ATM|모바일/.test(markdown), 'currency_payment:fee_cash_conditions_required');
  add(issues, /환율/.test(markdown) && DATE_RE.test(markdown), 'currency_payment:rate_date_required');
  add(issues, URL_RE.test(markdown), 'currency_payment:evidence_required');
}

function validateEntry(markdown: string, issues: string[]): void {
  add(issues, /목적\s*국가|입국\s*국가/.test(markdown), 'entry_requirements:destination_country_required');
  add(issues, /국적|대한민국\s*여권|한국인/.test(markdown), 'entry_requirements:nationality_required');
  add(issues, /관광|출장|여행\s*목적/.test(markdown) && /체류\s*기간|\d+일/.test(markdown), 'entry_requirements:purpose_stay_required');
  add(issues, /여권/.test(markdown) && /비자|전자\s*허가|ETA|ESTA|입국\s*신고/i.test(markdown), 'entry_requirements:passport_authorization_required');
  add(issues, /https:\/\/(?:[^/]+\.)?(?:go\.|gov\.|embassy|immigration|customs)/i.test(markdown) || (/공식\s*1차\s*출처/.test(markdown) && URL_RE.test(markdown)), 'entry_requirements:official_primary_source_required');
  add(issues, DATE_RE.test(markdown), 'entry_requirements:checked_at_required');
}

function validateInsurance(markdown: string, tables: BlogInformationTable[], issues: string[]): void {
  const rows = rowsFrom(tables, /보장|항목|한도|자기부담|면책|청구/i);
  add(issues, rows.filter((row) => /의료|상해|질병|수하물|항공|배상/.test(rowText(row))).length >= 3, 'travel_insurance:coverage_rows_required');
  add(issues, rows.filter((row) => /한도/.test(rowText(row)) && PRICE_RE.test(rowText(row))).length >= 3, 'travel_insurance:limits_required');
  add(issues, /자기\s*부담금/.test(markdown) && PRICE_RE.test(markdown), 'travel_insurance:deductible_required');
  add(issues, /면책|보장\s*제외|제외\s*사항/.test(markdown), 'travel_insurance:exclusions_required');
  add(issues, /청구/.test(markdown) && /서류|조건|절차/.test(markdown), 'travel_insurance:claim_conditions_required');
  add(issues, /약관|보험사|감독기관|공식\s*1차\s*출처/.test(markdown) && URL_RE.test(markdown), 'travel_insurance:official_policy_source_required');
}

export function validateBlogInformationStructure(input: {
  intent: BlogInformationIntent;
  markdown: string;
}): BlogInformationStructureReport {
  const markdown = input.markdown.normalize('NFKC');
  const tables = parseBlogInformationTables(markdown);
  const issues: string[] = [];
  const plain = stripMarkup(markdown, { collapseWhitespace: false });

  if (input.intent === 'general') {
    issues.push('general:public_intent_unresolved');
  } else {
    const validators: Record<Exclude<BlogInformationIntent, 'general'>, () => void> = {
      food_budget: () => validateFood(markdown, tables, issues),
      monthly_weather: () => validateWeather(markdown, tables, issues),
      airport_transport: () => validateAirport(markdown, tables, issues),
      local_transport: () => validateLocalTransport(markdown, tables, issues),
      hotel_areas: () => validateHotel(markdown, tables, issues),
      family_budget: () => validateFamilyBudget(markdown, tables, issues),
      itinerary: () => validateItinerary(markdown, tables, issues),
      shopping_souvenirs: () => validateShopping(markdown, tables, issues),
      currency_payment: () => validateCurrency(markdown, tables, issues),
      entry_requirements: () => validateEntry(markdown, issues),
      travel_insurance: () => validateInsurance(markdown, tables, issues),
    };
    validators[input.intent]();
  }

  const meaningfulRows = tables.flatMap((table) => table.rows).filter((row) => row.every(meaningful));
  const tableCentricIntent = input.intent !== 'entry_requirements';
  const uniqueNumbers = numericValues(
    meaningfulRows.length > 0 && tableCentricIntent
      ? meaningfulRows.flat().join(' ')
      : plain,
  );
  if (meaningfulRows.length > 0 && uniqueNumbers.length <= 1) issues.push(`${input.intent}:insufficient_unique_values`);
  return {
    passed: issues.length === 0,
    issues: [...new Set(issues)],
    tableCount: tables.length,
    meaningfulRowCount: meaningfulRows.length,
    uniqueNumericValueCount: uniqueNumbers.length,
  };
}
