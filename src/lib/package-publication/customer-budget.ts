import { extractSourceWonAmounts } from '@/lib/parser/deterministic/price-ir/source-money';

export type CustomerBudgetFuelStatus =
  | 'included'
  | 'excluded_fixed'
  | 'excluded_unpriced'
  | 'conflicting'
  | 'not_stated';

export type CustomerBudget = {
  currency: 'KRW';
  base_product_price: number | null;
  fuel_surcharge: {
    status: CustomerBudgetFuelStatus;
    amount: number | null;
    source_text: string | null;
  };
  expected_budget: number | null;
  expected_budget_display: string | null;
  calculation: 'base_only' | 'base_plus_fuel' | 'fuel_confirmation_required' | 'unavailable';
  guide_fee_excluded: boolean;
  guide_fee_source_text: string | null;
};

const FUEL_RE = /(?:유류\s*(?:할증료|세|비)|연료\s*할증료)/iu;
const VARIABLE_FUEL_RE = /(?:변동\s*분?|인상\s*분?|차액|추후|변경|별도\s*문의|확인)/iu;
const GUIDE_FEE_RE = /(?:(?:기사\s*[\/&·ㆍ+]\s*)?가이드\s*(?:경비|비용|비|팁|수고비)|기사\s*(?:경비|비용|팁))/iu;

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.normalize('NFKC').trim()];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const text = (item as { text?: unknown }).text;
      return typeof text === 'string' && text.trim() ? [text.normalize('NFKC').trim()] : [];
    }
    return [];
  });
}

function uniqueWonAmounts(lines: string[]): number[] {
  return [...new Set(lines.flatMap(line => extractSourceWonAmounts(line, {
    allowBareSaleShorthand: false,
    minAmount: 1_000,
    maxAmount: 5_000_000,
  }).map(candidate => candidate.amount)))];
}

function won(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`;
}

/**
 * Customer budget is deliberately narrower than every possible local cost.
 * Per owner policy it consists only of the evidence-backed base product price
 * plus a fixed excluded fuel surcharge. Guide/driver fees remain exclusions
 * and can never be added to this total.
 */
export function buildCustomerBudget(input: {
  baseProductPrice: number | null;
  inclusions: unknown;
  exclusions: unknown;
}): CustomerBudget {
  const inclusions = textList(input.inclusions);
  const exclusions = textList(input.exclusions);
  const includedFuelLines = inclusions.filter(line => FUEL_RE.test(line));
  const excludedFuelLines = exclusions.filter(line => FUEL_RE.test(line));
  const guideFeeLines = exclusions.filter(line => GUIDE_FEE_RE.test(line));
  const fixedFuelAmounts = uniqueWonAmounts(excludedFuelLines);
  const hasVariableFuel = excludedFuelLines.some(line => VARIABLE_FUEL_RE.test(line));
  const hasFuelScopeConflict = includedFuelLines.length > 0 && excludedFuelLines.length > 0;

  let fuelStatus: CustomerBudgetFuelStatus = 'not_stated';
  let fuelAmount: number | null = null;
  if (hasFuelScopeConflict) {
    fuelStatus = 'conflicting';
  } else if (excludedFuelLines.length > 0) {
    if (hasVariableFuel || fixedFuelAmounts.length === 0) {
      fuelStatus = 'excluded_unpriced';
    } else if (fixedFuelAmounts.length === 1) {
      fuelStatus = 'excluded_fixed';
      fuelAmount = fixedFuelAmounts[0]!;
    } else {
      fuelStatus = 'conflicting';
    }
  } else if (includedFuelLines.length > 0) {
    fuelStatus = 'included';
  }

  const baseProductPrice = typeof input.baseProductPrice === 'number'
    && Number.isFinite(input.baseProductPrice)
    && input.baseProductPrice > 0
    ? Math.round(input.baseProductPrice)
    : null;
  const expectedBudget = baseProductPrice == null
    ? null
    : fuelStatus === 'excluded_fixed' && fuelAmount != null
      ? baseProductPrice + fuelAmount
      : fuelStatus === 'excluded_unpriced' || fuelStatus === 'conflicting'
        ? null
        : baseProductPrice;
  const calculation: CustomerBudget['calculation'] = baseProductPrice == null
    ? 'unavailable'
    : fuelStatus === 'excluded_fixed'
      ? 'base_plus_fuel'
      : fuelStatus === 'excluded_unpriced' || fuelStatus === 'conflicting'
        ? 'fuel_confirmation_required'
        : 'base_only';

  return {
    currency: 'KRW',
    base_product_price: baseProductPrice,
    fuel_surcharge: {
      status: fuelStatus,
      amount: fuelAmount,
      source_text: hasFuelScopeConflict
        ? `${includedFuelLines[0]} / ${excludedFuelLines[0]}`
        : excludedFuelLines[0] ?? includedFuelLines[0] ?? null,
    },
    expected_budget: expectedBudget,
    expected_budget_display: expectedBudget == null ? null : won(expectedBudget),
    calculation,
    guide_fee_excluded: guideFeeLines.length > 0,
    guide_fee_source_text: guideFeeLines[0] ?? null,
  };
}
