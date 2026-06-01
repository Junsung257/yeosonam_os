import { renderPackage } from '@/lib/render-contract';
import { evaluateRenderClaimCoverage } from '@/lib/render-claim-coverage';
import { evidenceCoverage } from '@/lib/source-evidence';
import {
  REQUIRED_V2_CUSTOMER_EVIDENCE_FIELDS,
} from './evidence-verifier';
import type {
  ProductRegistrationV2ExecutedProduct,
  ProductRegistrationV2GateCheck,
  ProductRegistrationV2GateResult,
  ProductRegistrationV2Plan,
} from './types';

function check(status: ProductRegistrationV2GateCheck['status'], id: string, message: string, severity: ProductRegistrationV2GateCheck['severity']): ProductRegistrationV2GateCheck {
  return { id, status, message, severity };
}

export function evaluateProductRegistrationV2Gate(
  plan: ProductRegistrationV2Plan,
  products: ProductRegistrationV2ExecutedProduct[],
): ProductRegistrationV2GateResult {
  const checks: ProductRegistrationV2GateCheck[] = [];

  checks.push(products.length === plan.expected_products
    ? check('pass', 'expected_products', `${products.length}/${plan.expected_products} products`, 'critical')
    : check('fail', 'expected_products', `${products.length}/${plan.expected_products} products`, 'critical'));

  if (plan.price_mapping_strategy === 'unknown') {
    checks.push(check('fail', 'price_mapping_strategy', '가격표 매핑 전략 미정', 'critical'));
  } else {
    checks.push(check('pass', 'price_mapping_strategy', plan.price_mapping_strategy, 'critical'));
  }

  for (const product of products) {
    const prefix = `product_${product.index}`;
    const priceDates = product.renderInput.price_dates ?? [];
    checks.push(priceDates.length > 0
      ? check('pass', `${prefix}_price_dates`, `${priceDates.length} price_dates`, 'critical')
      : check('fail', `${prefix}_price_dates`, 'price_dates 없음', 'critical'));

    const view = renderPackage(product.renderInput);
    const out = view.flightHeader.outbound;
    const inbound = view.flightHeader.inbound;
    checks.push(out?.code === 'BX337' && out.depTime === '09:40' && out.arrTime === '11:30'
      ? check('pass', `${prefix}_outbound_flight`, 'BX337 09:40-11:30', 'critical')
      : check('fail', `${prefix}_outbound_flight`, `outbound mismatch ${out?.code ?? '-'} ${out?.depTime ?? '-'}-${out?.arrTime ?? '-'}`, 'critical'));
    checks.push(inbound?.code === 'BX338' && inbound.depTime === '12:30' && inbound.arrTime === '16:25'
      ? check('pass', `${prefix}_inbound_flight`, 'BX338 12:30-16:25', 'critical')
      : check('fail', `${prefix}_inbound_flight`, `inbound mismatch ${inbound?.code ?? '-'} ${inbound?.depTime ?? '-'}-${inbound?.arrTime ?? '-'}`, 'critical'));
    checks.push(out?.depTime === '06:30'
      ? check('fail', `${prefix}_meeting_time_as_flight`, '06:30이 항공 출발시간으로 노출됨', 'critical')
      : check('pass', `${prefix}_meeting_time_as_flight`, '06:30은 항공 출발시간 아님', 'critical'));

    checks.push(view.days.length === product.extractedData.duration
      ? check('pass', `${prefix}_duration_days`, `${view.days.length} days`, 'critical')
      : check('fail', `${prefix}_duration_days`, `duration ${product.extractedData.duration} vs view ${view.days.length}`, 'critical'));

    const coverage = evidenceCoverage(product.sourceEvidence, [...REQUIRED_V2_CUSTOMER_EVIDENCE_FIELDS]);
    checks.push(coverage.missing.length === 0
      ? check('pass', `${prefix}_evidence`, '고객 노출 필수 evidence 충족', 'critical')
      : check('fail', `${prefix}_evidence`, `evidence missing: ${coverage.missing.join(', ')}`, 'critical'));

    const renderCoverage = evaluateRenderClaimCoverage(product.renderInput, product.sourceEvidence);
    const criticalRenderUnsupported = renderCoverage.unsupported.filter(claim =>
      claim.surface === 'flight' || claim.surface === 'itinerary' || claim.surface === 'hotel'
    );
    checks.push(criticalRenderUnsupported.length === 0
      ? check('pass', `${prefix}_render_claim_coverage`, 'render claims backed by raw/evidence', 'critical')
      : check('fail', `${prefix}_render_claim_coverage`, `unsupported render claims ${criticalRenderUnsupported.slice(0, 5).map(c => `${c.id}=${c.value}`).join(' / ')}`, 'critical'));

    const noise = product.attractionCandidates.filter(c =>
      /^(부산|연길|도문|용정|이도백하|북파|서파|전용차량|전일|호텔식|현지식|김\s*밥|냉면|꿔바로우|삼겹살|샤브샤브|무제한)$/.test(c.replace(/\s+/g, '')),
    );
    checks.push(noise.length === 0
      ? check('pass', `${prefix}_attraction_noise`, '관광지 후보 노이즈 없음', 'high')
      : check('fail', `${prefix}_attraction_noise`, `관광지 후보 노이즈: ${noise.join(', ')}`, 'high'));
  }

  const failed = checks.filter(c => c.status === 'fail');
  const critical = failed.filter(c => c.severity === 'critical');
  return {
    status: critical.length > 0 ? 'blocked' : failed.length > 0 ? 'pending_review' : 'clean',
    customer_publishable: failed.length === 0,
    checks,
  };
}
