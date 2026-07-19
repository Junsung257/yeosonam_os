// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'rfq-1' }),
  useSearchParams: () => new URLSearchParams('share_token=share-1&proposal_id=proposal-1'),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import RfqChatPage from './page';

describe('RFQ customer chat integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('passes the share token, parses the messages envelope, and keeps share views read-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [{
          id: 'message-1', sender_type: 'tenant', processed_content: '안전한 처리 메시지',
          pii_blocked: false, is_visible_to_customer: true, created_at: '2026-07-19T00:00:00.000Z',
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RfqChatPage />);

    expect(await screen.findByText('안전한 처리 메시지')).not.toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/rfq/rfq-1/messages?proposal_id=proposal-1',
      { headers: { 'x-rfq-share-token': 'share-1' } },
    ));
    expect(screen.getByText(/공유 링크에서는 대화를 읽기만/)).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
