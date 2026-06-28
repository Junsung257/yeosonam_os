import type { TrackingData } from '@/hooks/useTracking';
import { trackLead } from '@/components/MetaPixel';
import { safeOpenNewWindow } from '@/lib/safe-window-open';

export interface KakaoLeadContext {
  productTitle?: string;
  internalCode?: string;
  leadValueForPixel?: number;
}

export interface LeadFormData {
  desiredDate: string;
  adults: number;
  children: number;
  name: string;
  phone: string;
  privacyConsent: boolean;
  termsConsent?: boolean;
}

export interface LeadPayload {
  productId: string;
  channel: string;
  form: LeadFormData;
  tracking: TrackingData;
  submittedAt: string;
  chatSessionId?: string;
  idempotencyKey?: string;
}

export interface LeadSubmitResult {
  ok: boolean;
  lead_id?: string | null;
  idempotent_replay?: boolean;
  booking?: {
    id?: string;
    booking_no?: string | null;
    status?: string | null;
  } | null;
}

export function buildPayload(
  productId: string,
  form: LeadFormData,
  tracking: TrackingData,
  chatSessionId?: string,
): LeadPayload {
  const phoneDigits = form.phone.replace(/\D/g, '');
  return {
    productId,
    channel: tracking.utmSource ?? 'organic',
    form,
    tracking,
    submittedAt: new Date().toISOString(),
    chatSessionId,
    idempotencyKey: [
      'lp',
      productId,
      form.desiredDate || 'date',
      phoneDigits || 'phone',
      String(form.adults || 1),
      String(form.children || 0),
    ].join(':'),
  };
}

async function postLead(payload: LeadPayload): Promise<LeadSubmitResult> {
  const res = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return body as LeadSubmitResult;
}

export async function submitWithRetry(payload: LeadPayload, maxRetries = 3): Promise<LeadSubmitResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await postLead(payload);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 400));
      }
    }
  }
  throw lastError;
}

export function buildKakaoMessage(form: LeadFormData, ctx?: KakaoLeadContext, result?: LeadSubmitResult): string {
  const lines = ['안녕하세요. 아래 상품 예약 요청드립니다.', ''];
  if (result?.booking?.booking_no) lines.push(`예약번호: ${result.booking.booking_no}`);
  if (ctx?.internalCode) lines.push(`상품코드: ${ctx.internalCode}`);
  if (ctx?.productTitle) lines.push(`상품명: ${ctx.productTitle}`);
  if (form.desiredDate) lines.push(`출발일: ${form.desiredDate}`);
  const paxParts: string[] = [];
  if (form.adults) paxParts.push(`성인 ${form.adults}명`);
  if (form.children) paxParts.push(`아동 ${form.children}명`);
  if (paxParts.length) lines.push(`인원: ${paxParts.join(', ')}`);
  if (form.name) lines.push(`이름: ${form.name}`);
  if (form.phone) lines.push(`연락처: ${form.phone}`);
  if (typeof window !== 'undefined') lines.push(`페이지: ${window.location.href}`);
  return lines.join('\n').trim();
}

export function redirectToKakao(kakaoChannelUrl: string): void {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );
  if (isMobile) {
    const fallback = kakaoChannelUrl;
    window.location.href = fallback;
  } else {
    safeOpenNewWindow(kakaoChannelUrl);
  }
}

export async function submitLeadPipeline(
  productId: string,
  form: LeadFormData,
  tracking: TrackingData,
  kakaoChannelUrl: string,
  kakaoContext?: KakaoLeadContext,
  chatSessionId?: string,
): Promise<void> {
  const payload = buildPayload(productId, form, tracking, chatSessionId);
  let result: LeadSubmitResult | undefined;

  try {
    result = await submitWithRetry(payload);
    trackLead({
      content_name: kakaoContext?.productTitle ?? '여행 예약 요청',
      value: kakaoContext?.leadValueForPixel ?? 0,
      content_ids: [productId],
    });
  } catch (err) {
    console.error('[LeadPipeline] submit failed:', err);
  }

  try {
    const message = buildKakaoMessage(form, kakaoContext, result);
    await navigator.clipboard.writeText(message);
  } catch {
    // Clipboard can fail on some mobile browsers; continue to Kakao.
  }

  redirectToKakao(kakaoChannelUrl);
}
