import { describe, expect, it } from 'vitest';
import { runProductRegistrationV3 } from './index';
import { evaluateCustomerDeliveryReadiness } from '@/lib/customer-delivery-check';
import { collectEvidenceForValues } from '@/lib/source-evidence';
import type { PublishGateFailedCheck } from '@/lib/product-publish-gate';

function toFailedChecksFromV3Gate(result: Awaited<ReturnType<typeof runProductRegistrationV3>>): PublishGateFailedCheck[] {
  return result.gate_result.checks
    .filter(check => check.status === 'fail')
    .map(check => ({
      id: check.id,
      severity: check.severity === 'info' ? 'high' : check.severity,
      passed: false,
      message: check.message,
    }));
}

function toCustomerDeliveryPkg(raw: string, result: Awaited<ReturnType<typeof runProductRegistrationV3>>) {
  const preview = result.render_contract_preview[0];
  return {
    audit_status: 'clean',
    audit_report: {},
    title: preview.title ?? 'V3 Package',
    destination: '나트랑/달랏',
    trip_style: '3박5일',
    duration: 5,
    nights: 3,
    departure_airport: '부산',
    airline: 'LJ',
    min_participants: 6,
    price_tiers: [{ period_label: '기본', adult_price: preview.price_dates?.[0]?.price ?? 619000, status: 'available' }],
    inclusions: preview.inclusions ?? [],
    excludes: preview.excludes ?? [],
    itinerary_data: preview.itinerary_data,
    raw_text: raw,
  };
}

describe('V3 -> customer delivery gate integration', () => {
  it('keeps customer delivery blocked when final render claim coverage still has unsupported claim', async () => {
    const raw = `
상품: 나트랑 달랏 3박5일
가격 619,000원 / 최소출발 6명
DAY 1 LJ115 부산 출발 21:35 도착 00:25
DAY 2 포나가르 사원 관광
REMARK
호텔 룸배정(일행과 같은 층, 옆방 배정, 베드 타입) 등은 개런티 불가합니다.
전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.
DAY 5 LJ116 출발 01:00 도착 06:40
포함 호텔
개인경비 · 불포함
`.trim();
    const v3 = await runProductRegistrationV3(raw);
    const pkg = toCustomerDeliveryPkg(raw, v3);
    const result = evaluateCustomerDeliveryReadiness({
      pkg,
      sourceEvidence: null,
      failedChecks: [],
      requireCompletedAudit: true,
    });
    expect(v3.gate_result.status).not.toBe('blocked');
    expect(result.customerDeliverable).toBe(false);
    expect(result.publishGate.decision).toBe('force_required');
    const gateNotes = [...result.publishGate.reasons, ...result.publishGate.warnings].join('\n');
    expect(gateNotes).toContain('원문 근거');
  });

  it('blocks customer delivery when V3 high-risk notice check fails', async () => {
    const raw = `
상품: 하이리스크 검증
가격 499,000원 / 최소출발 4명
DAY 1 KE123 출발 10:00 도착 12:00
REMARK
싱글차지 발생합니다.
DAY 3 KE124 출발 13:00 도착 15:00
`.trim();
    const v3 = await runProductRegistrationV3(raw);
    const pkg = toCustomerDeliveryPkg(raw, v3);
    const failedChecks = toFailedChecksFromV3Gate(v3);
    const sourceEvidence = collectEvidenceForValues(raw, [
      ['meta.region', '검증'],
      ['meta.tripStyle', '3박5일'],
      ['meta.minParticipants', 4],
      ['meta.airline', 'KE'],
      ['flights.outbound[0].code', 'KE123'],
      ['flights.inbound[0].code', 'KE124'],
      ['priceGroups[0].adultPrice', 499000],
    ]);

    const result = evaluateCustomerDeliveryReadiness({
      pkg,
      sourceEvidence,
      failedChecks,
      requireCompletedAudit: true,
    });

    expect(v3.gate_result.status).toBe('blocked');
    expect(failedChecks.some(c => c.id?.endsWith('high_risk_notice_values'))).toBe(true);
    expect(result.customerDeliverable).toBe(false);
    expect(result.publishGate.decision).toBe('block');
  });
});
