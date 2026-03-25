import type { TrackingData } from '@/hooks/useTracking';

export interface LeadFormData {
  desiredDate: string;       // "YYYY-MM-DD"
  adults: number;
  children: number;
  name: string;
  phone: string;             // "010-XXXX-XXXX"
  privacyConsent: boolean;
}

export interface LeadPayload {
  productId: string;
  channel: string;           // utm_source 또는 'organic'
  form: LeadFormData;
  tracking: TrackingData;
  submittedAt: string;       // ISO
}

export function buildPayload(
  productId: string,
  form: LeadFormData,
  tracking: TrackingData
): LeadPayload {
  return {
    productId,
    channel: tracking.utmSource ?? 'organic',
    form,
    tracking,
    submittedAt: new Date().toISOString(),
  };
}

async function postLead(payload: LeadPayload): Promise<void> {
  const res = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
}

export async function submitWithRetry(payload: LeadPayload, maxRetries = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await postLead(payload);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 400));
      }
    }
  }
  throw lastError;
}

export function redirectToKakao(kakaoChannelUrl: string): void {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );
  if (isMobile) {
    // 카카오톡 앱 deep link 시도 후 fallback
    const deepLink = 'kakaotalk://plusfriend/home/@여소남';
    const fallback = kakaoChannelUrl;
    window.location.href = deepLink;
    setTimeout(() => {
      window.open(fallback, '_blank');
    }, 1500);
  } else {
    window.open(kakaoChannelUrl, '_blank');
  }
}

export async function submitLeadPipeline(
  productId: string,
  form: LeadFormData,
  tracking: TrackingData,
  kakaoChannelUrl: string
): Promise<void> {
  const payload = buildPayload(productId, form, tracking);
  // 실패해도 카카오 이동은 막지 않음 (UX 우선)
  await submitWithRetry(payload).catch(err =>
    console.error('[LeadPipeline] submit failed:', err)
  );
  redirectToKakao(kakaoChannelUrl);
}
