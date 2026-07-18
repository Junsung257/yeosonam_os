// @vitest-environment jsdom

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrivateTourLandingClient from './PrivateTourLandingClient';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/MetaPixel', () => ({ trackLead: vi.fn() }));
vi.mock('@/lib/tracker', () => ({ trackEngagement: vi.fn() }));

describe('private-tour RFQ consent integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks an unconsented submission and persists exact boolean consent on the normal flow', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      Response.json({ rfq: { id: 'rfq-1' }, share_url: null })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<PrivateTourLandingClient />);

    fireEvent.change(container.querySelector('#private-tour-contact-name') as HTMLInputElement, { target: { value: '홍길동' } });
    fireEvent.change(container.querySelector('#private-tour-contact-phone') as HTMLInputElement, { target: { value: '01012345678' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    const stepTwoForm = container.querySelector('form') as HTMLFormElement;
    fireEvent.click(stepTwoForm.querySelector('button[type="button"]') as HTMLButtonElement);
    const pax = stepTwoForm.querySelector('#private-tour-pax') as HTMLSelectElement;
    fireEvent.change(pax, { target: { value: pax.options[1]?.value } });
    fireEvent.change(stepTwoForm.querySelector('#private-tour-destination') as HTMLInputElement, { target: { value: '도쿄' } });
    fireEvent.submit(stepTwoForm);

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    const finalForm = container.querySelector('form') as HTMLFormElement;
    fireEvent.click(finalForm.querySelector('button[type="button"]') as HTMLButtonElement);
    fireEvent.submit(finalForm);

    expect(getByText('견적 상담과 연락을 위해 개인정보 안내에 동의해주세요.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(finalForm.querySelector('input[type="checkbox"]') as HTMLInputElement);
    fireEvent.submit(finalForm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0];
    const init = request?.[1];
    expect(init).toBeDefined();
    const payload = JSON.parse(String(init?.body)) as { custom_requirements: { privacy_consent: unknown } };
    expect(payload.custom_requirements.privacy_consent).toBe(true);
    expect(push).toHaveBeenCalledWith('/rfq/rfq-1');
  });
});
