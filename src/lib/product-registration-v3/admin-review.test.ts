import { describe, expect, it } from 'vitest';
import { buildStandardNoticeCustomerSavePayload } from './admin-review';
import { buildStandardNoticeDraft } from './standard-notices';

const evidence = (quote: string) => [{
  line_start: 7,
  line_end: 7,
  char_start: 0,
  char_end: quote.length,
  quote,
}];

describe('product-registration-v3 admin review save payload', () => {
  it('saves only publishable standard notices to customer-visible fields', () => {
    const safeSource = '전체 일정 & 식사 순서는 현지 사정에 의해 다소 변경될 수 있습니다.';
    const reviewNeededSource = '싱글차지 전일정 기준 인당 18만 원 추가됩니다.';
    const safeNotice = buildStandardNoticeDraft({
      source_text: safeSource,
      category: 'itinerary_change',
      values: {},
      evidence: evidence(safeSource),
    });
    const reviewNeededNotice = buildStandardNoticeDraft({
      source_text: reviewNeededSource,
      category: 'single_room_surcharge',
      values: { amount: 180000, currency: '원' },
      evidence: evidence(reviewNeededSource),
    });

    const result = buildStandardNoticeCustomerSavePayload('pkg-1', [
      { ...safeNotice!, values_valid: true },
      { ...reviewNeededNotice!, values_valid: true },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.saved_count).toBe(1);
    expect(result.payload.skipped_count).toBe(1);
    expect(result.payload.customer_notes).toBe('항공 및 현지 사정에 따라 일정과 식사 순서는 변경될 수 있습니다.');
    expect(JSON.stringify(result.payload)).not.toContain(safeSource);
    expect(JSON.stringify(result.payload)).not.toContain(reviewNeededSource);
    expect(JSON.stringify(result.payload)).not.toContain('18만 원 추가됩니다');
  });

  it('allows manually approved high-risk notices but still stores only standard text', () => {
    const source = '패키지 일정 미참여 시 패널티 1인/1박/$100 청구됩니다.';
    const notice = buildStandardNoticeDraft({
      source_text: source,
      category: 'group_schedule_penalty',
      values: { amount: 100, currency: 'USD', unit: '1인 1박당' },
      evidence: evidence(source),
      review_status: 'manual_approved',
    });

    const result = buildStandardNoticeCustomerSavePayload('pkg-2', [{ ...notice!, values_valid: true }]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.payload.saved_count).toBe(1);
    expect(result.payload.notices_parsed[0].review_status).toBe('manual_approved');
    expect(result.payload.customer_notes).toContain('1인 1박당 100USD');
    expect(JSON.stringify(result.payload)).not.toContain(source);
  });

  it('rejects invalid extracted value JSON rows before building a payload', () => {
    const source = '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.';
    const notice = buildStandardNoticeDraft({
      source_text: source,
      category: 'passport_validity',
      values: { months: 6 },
      evidence: evidence(source),
    });

    const result = buildStandardNoticeCustomerSavePayload('pkg-3', [{ ...notice!, values_valid: false }]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected invalid payload');
    expect(result.error).toContain('추출값 JSON');
  });
});
