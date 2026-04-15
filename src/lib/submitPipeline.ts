import type { TrackingData } from '@/hooks/useTracking';

export interface KakaoLeadContext {
  productTitle?: string;
  internalCode?: string;
}

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
  chatSessionId?: string;    // 채팅 세션 — 백엔드가 conversations/customer_facts 역참조에 사용
}

export function buildPayload(
  productId: string,
  form: LeadFormData,
  tracking: TrackingData,
  chatSessionId?: string,
): LeadPayload {
  return {
    productId,
    channel: tracking.utmSource ?? 'organic',
    form,
    tracking,
    submittedAt: new Date().toISOString(),
    chatSessionId,
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

function buildKakaoMessage(form: LeadFormData, ctx?: KakaoLeadContext): string {
  const lines = ['안녕하세요! 아래 상품 문의드립니다.', ''];
  if (ctx?.internalCode) lines.push(`상품코드: ${ctx.internalCode}`);
  if (ctx?.productTitle) lines.push(`상품명: ${ctx.productTitle}`);
  if (form.desiredDate) lines.push(`출발일: ${form.desiredDate}`);
  const paxParts: string[] = [];
  if (form.adults) paxParts.push(`성인 ${form.adults}`);
  if (form.children) paxParts.push(`소아 ${form.children}`);
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
  kakaoChannelUrl: string,
  kakaoContext?: KakaoLeadContext,
  chatSessionId?: string,
): Promise<void> {
  const payload = buildPayload(productId, form, tracking, chatSessionId);
  // 실패해도 카카오 이동은 막지 않음 (UX 우선)
  await submitWithRetry(payload).catch(err =>
    console.error('[LeadPipeline] submit failed:', err)
  );
  // 카카오 채팅창에 붙여넣기 좋은 메시지를 클립보드에 복사
  try {
    const message = buildKakaoMessage(form, kakaoContext);
    await navigator.clipboard.writeText(message);
  } catch {
    // 클립보드 API 실패 (HTTP 환경 등) 시 무시 — 카카오 이동은 진행
  }
  redirectToKakao(kakaoChannelUrl);
}
