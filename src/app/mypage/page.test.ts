import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('/mypage safe pre-auth state', () => {
  it('does not present fabricated customer facts or broken booking links', () => {
    expect(source).not.toContain('MOCK_MILEAGE');
    expect(source).not.toContain('MOCK_BOOKINGS');
    expect(source).not.toContain("fetch('/api/auth/session')");
    expect(source).not.toContain('href={`/voucher/');
    expect(source).not.toContain('href={`/rfq/${booking.id}/chat`}');
  });

  it('directs customers to their secure message link or support', () => {
    expect(source).toContain('전용 링크');
    expect(source).toContain('getKakaoChannelChatUrl');
    expect(source).toContain('href="/packages"');
  });
});
