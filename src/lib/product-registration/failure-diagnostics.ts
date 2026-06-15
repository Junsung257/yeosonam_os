export type ProductRegistrationFailureSeverity = 'critical' | 'high' | 'medium' | 'low';

export type ProductRegistrationFailureCode =
  | 'PRICE_ROWS_MISSING'
  | 'PRICE_DATES_MISSING'
  | 'PRICE_DATE_DISAGREEMENT'
  | 'PRICE_AMOUNT_DISAGREEMENT'
  | 'MODEL_PRICE_UNSUPPORTED'
  | 'DESTINATION_UNRESOLVED'
  | 'ITINERARY_MISSING'
  | 'ITINERARY_DUPLICATE_DAY'
  | 'ITINERARY_DURATION_OVERFLOW'
  | 'FLIGHT_TIME_MISMATCH'
  | 'CATALOG_SPLIT_REQUIRED'
  | 'PRODUCT_COUNT_MISMATCH'
  | 'MOBILE_RENDER_FAILED'
  | 'A4_RENDER_FAILED'
  | 'ATTRACTION_CONTEXT_MISMATCH'
  | 'ATTRACTION_UNRESOLVED'
  | 'CUSTOMER_RENDER_BLOCKED'
  | 'UPLOAD_DISCONNECTED'
  | 'UNKNOWN_BLOCKER';

export type ProductRegistrationFailureDiagnostic = {
  code: ProductRegistrationFailureCode;
  severity: ProductRegistrationFailureSeverity;
  message: string;
  nextAction: string;
};

type Rule = {
  code: ProductRegistrationFailureCode;
  severity: ProductRegistrationFailureSeverity;
  patterns: RegExp[];
  nextAction: string;
};

const RULES: Rule[] = [
  {
    code: 'PRICE_ROWS_MISSING',
    severity: 'critical',
    patterns: [/product_prices missing/i, /price_tiers\s*없음/i, /product_prices\s*없음/i],
    nextAction: 'Recover source-backed product price rows before saving or opening the product.',
  },
  {
    code: 'PRICE_DATES_MISSING',
    severity: 'critical',
    patterns: [/price_dates missing/i, /price_dates\s*없음/i],
    nextAction: 'Recover source-backed departure dates and date-level minimum prices.',
  },
  {
    code: 'PRICE_DATE_DISAGREEMENT',
    severity: 'critical',
    patterns: [/price date disagreement/i, /source-backed dates.*do not overlap/i, /price_dates missing date/i],
    nextAction: 'Re-parse the original price table and align product_prices with price_dates from the same source span.',
  },
  {
    code: 'PRICE_AMOUNT_DISAGREEMENT',
    severity: 'critical',
    patterns: [/price amount disagreement/i, /product_prices min .*!= price_dates/i, /price storage mismatch/i],
    nextAction: 'Use source-backed rows to rebuild the date-level minimum price summary.',
  },
  {
    code: 'MODEL_PRICE_UNSUPPORTED',
    severity: 'critical',
    patterns: [/model-derived price source/i, /ai_fallback:gemini/i, /gemini:실패/i, /Too Many Requests/i],
    nextAction: 'Do not publish model-only prices; recover deterministic or supplier-raw price evidence.',
  },
  {
    code: 'DESTINATION_UNRESOLVED',
    severity: 'critical',
    patterns: [/destination code unresolved/i, /Destination resolution failed/i, /destination_code:UNK/i, /\bUNK\b/],
    nextAction: 'Resolve the internal destination code using route, title, and itinerary evidence before customer render.',
  },
  {
    code: 'ITINERARY_MISSING',
    severity: 'critical',
    patterns: [/itinerary missing/i, /requires itinerary days/i, /itinerary\.days missing/i, /a4\.days missing/i],
    nextAction: 'Recover source-backed itinerary days before saving customer-facing payloads.',
  },
  {
    code: 'ITINERARY_DUPLICATE_DAY',
    severity: 'critical',
    patterns: [/itinerary duplicate day number/i, /duplicate day/i],
    nextAction: 'Repair catalog boundaries or day normalization so each product has one clean day sequence.',
  },
  {
    code: 'ITINERARY_DURATION_OVERFLOW',
    severity: 'critical',
    patterns: [/itinerary duration overflow/i, /duration .* but itinerary has/i],
    nextAction: 'Split catalog products by source boundaries and remove appendix/shared sections from itinerary days.',
  },
  {
    code: 'FLIGHT_TIME_MISMATCH',
    severity: 'critical',
    patterns: [/flight time source mismatch/i, /saved segments are incomplete/i, /source has round-trip flight times/i],
    nextAction: 'Recover outbound and inbound flight code, departure time, and arrival time from the original source.',
  },
  {
    code: 'CATALOG_SPLIT_REQUIRED',
    severity: 'critical',
    patterns: [/CATALOG_SPLIT_REQUIRED/i, /catalog split failed/i, /processed as 1 product/i],
    nextAction: 'Run deterministic catalog split recovery before product registration.',
  },
  {
    code: 'PRODUCT_COUNT_MISMATCH',
    severity: 'critical',
    patterns: [/PRODUCT_COUNT_MISMATCH/i, /expected product count does not match/i],
    nextAction: 'Reconcile V3 expected product count with actual source-backed product sections.',
  },
  {
    code: 'MOBILE_RENDER_FAILED',
    severity: 'critical',
    patterns: [/mobile render failed/i, /landing render error/i, /landing\.priceFrom missing/i, /landing\.itinerary\.days missing/i],
    nextAction: 'Block customer opening and verify the actual mobile landing render after repair.',
  },
  {
    code: 'A4_RENDER_FAILED',
    severity: 'critical',
    patterns: [/A4 render failed/i, /a4 render error/i, /a4\.price_dates missing/i],
    nextAction: 'Block customer opening and repair A4 render-contract payloads.',
  },
  {
    code: 'ATTRACTION_CONTEXT_MISMATCH',
    severity: 'critical',
    patterns: [/attraction_context_mismatch/i, /cross-region attraction/i, /region-mismatched/i],
    nextAction: 'Strip wrong attraction cards and require destination-compatible source-supported matching.',
  },
  {
    code: 'ATTRACTION_UNRESOLVED',
    severity: 'high',
    patterns: [/attraction_unresolved/i, /unmatched attraction/i, /attraction unmatched/i],
    nextAction: 'Keep the source phrase visible and send the entity through review or safe existing-master matching.',
  },
  {
    code: 'CUSTOMER_RENDER_BLOCKED',
    severity: 'critical',
    patterns: [/Customer landing\/A4 blocked/i, /\bBLOCKED:/i, /final upload gate blocked/i],
    nextAction: 'Keep the product out of customer visibility until all specific blocker codes are cleared.',
  },
  {
    code: 'UPLOAD_DISCONNECTED',
    severity: 'high',
    patterns: [/서버 응답 전에 끊겼습니다/i, /Failed to fetch/i, /request.*disconnected/i],
    nextAction: 'Check the upload review queue by uploadRequestId/file hash and replay the failed source through the deterministic runner.',
  },
];

function uniqueDiagnostics(items: ProductRegistrationFailureDiagnostic[]): ProductRegistrationFailureDiagnostic[] {
  const seen = new Set<ProductRegistrationFailureCode>();
  const unique: ProductRegistrationFailureDiagnostic[] = [];
  for (const item of items) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    unique.push(item);
  }
  return unique;
}

export function classifyProductRegistrationFailure(
  reason: string | null | undefined,
): ProductRegistrationFailureDiagnostic[] {
  const text = reason ?? '';
  if (!text.trim()) return [];

  const diagnostics = RULES
    .filter(rule => rule.patterns.some(pattern => pattern.test(text)))
    .map(rule => ({
      code: rule.code,
      severity: rule.severity,
      message: text.slice(0, 500),
      nextAction: rule.nextAction,
    }));

  if (diagnostics.length === 0) {
    diagnostics.push({
      code: 'UNKNOWN_BLOCKER',
      severity: 'high',
      message: text.slice(0, 500),
      nextAction: 'Convert this blocker into a stable code, fixture candidate, and regression test before marking it resolved.',
    });
  }

  return uniqueDiagnostics(diagnostics);
}

export function summarizeProductRegistrationFailures(
  reasons: Array<string | null | undefined>,
): {
  codes: ProductRegistrationFailureCode[];
  diagnostics: ProductRegistrationFailureDiagnostic[];
  hasCritical: boolean;
  nextAction: string;
} {
  const diagnostics = uniqueDiagnostics(reasons.flatMap(classifyProductRegistrationFailure));
  const codes = diagnostics.map(diagnostic => diagnostic.code);
  return {
    codes,
    diagnostics,
    hasCritical: diagnostics.some(diagnostic => diagnostic.severity === 'critical'),
    nextAction: diagnostics[0]?.nextAction ?? 'No blocker detected.',
  };
}
