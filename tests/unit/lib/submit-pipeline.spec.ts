import { describe, expect, it, vi } from 'vitest';
import { buildKakaoMessage, buildPayload } from '@/lib/submitPipeline';
import type { TrackingData } from '@/hooks/useTracking';

vi.mock('@/components/MetaPixel', () => ({
  trackLead: vi.fn(),
}));

const form = {
  desiredDate: '2026-07-15',
  adults: 2,
  children: 1,
  name: '홍길동',
  phone: '010-1234-5678',
  privacyConsent: true,
};

const tracking: TrackingData = {
  sessionId: 'session-1',
  utmSource: 'meta',
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  referrer: '',
  landingUrl: 'https://www.yeosonam.com/packages/pkg-123',
  scrollDepthReached: 0,
  timeOnPageSeconds: 0,
  itineraryViewed: false,
};

describe('submitPipeline', () => {
  it('builds a stable landing idempotency key from product, date, phone, and pax', () => {
    const payload = buildPayload(
      'pkg-123',
      form,
      tracking,
      'chat-session-1',
    );

    expect(payload.channel).toBe('meta');
    expect(payload.chatSessionId).toBe('chat-session-1');
    expect(payload.idempotencyKey).toBe('lp:pkg-123:2026-07-15:01012345678:2:1');
  });

  it('builds the customer Kakao handoff message with booking and product context', () => {
    const message = buildKakaoMessage(
      form,
      {
        internalCode: 'YSN-001',
        productTitle: '다낭 3박 5일',
      },
      {
        ok: true,
        booking: {
          id: 'booking-1',
          booking_no: 'B202605300001',
          status: 'pending',
        },
      },
    );

    expect(message).toContain('안녕하세요. 아래 상품 예약 요청드립니다.');
    expect(message).toContain('예약번호: B202605300001');
    expect(message).toContain('상품코드: YSN-001');
    expect(message).toContain('상품명: 다낭 3박 5일');
    expect(message).toContain('출발일: 2026-07-15');
    expect(message).toContain('인원: 성인 2명, 아동 1명');
    expect(message).toContain('이름: 홍길동');
    expect(message).toContain('연락처: 010-1234-5678');
  });
});
