/**
 * 카카오 모먼트 픽셀 이벤트 — 마케팅 동의(hasMarketingConsent) 시에만 발화.
 * 스크립트는 `KakaoMomentPixel` 이 로드한 뒤에만 동작.
 */
import { hasMarketingConsent } from '@/lib/consent';

const PID = process.env.NEXT_PUBLIC_KAKAO_PIXEL_ID;

type KakaoPixelApi = {
  pageView: () => void;
  viewContent: (p: { id: string; tag: string; value: string }) => void;
};

function getPixel(): KakaoPixelApi | null {
  if (!PID || typeof window === 'undefined') return null;
  const kp = (window as unknown as { kakaoPixel?: (id: string) => KakaoPixelApi }).kakaoPixel;
  if (typeof kp !== 'function') return null;
  try {
    return kp(PID);
  } catch {
    return null;
  }
}

export function trackKakaoPixelPageView(): void {
  if (!hasMarketingConsent()) return;
  getPixel()?.pageView();
}

/** 상품 LP·상세 등에서 호출 */
export function trackKakaoViewContent(params: { id: string; name: string; value: number }): void {
  if (!hasMarketingConsent()) return;
  const px = getPixel();
  if (!px) return;
  try {
    px.viewContent({
      id: params.id,
      tag: params.name.slice(0, 500),
      value: String(Math.round(params.value)),
    });
  } catch {
    /* noop */
  }
}

/**
 * 카카오 모먼트 Purchase 이벤트 (결제·예약 완료)
 * 체크아웃 완료 시 서버에서 호출하거나 프론트에서 직접 호출.
 * 마케팅 동의 없으면 noop.
 */
export function trackKakaoPurchase(params: { id: string; name: string; value: number; quantity?: number }): void {
  if (!hasMarketingConsent()) return;
  if (typeof window === 'undefined') return;
  const PID = process.env.NEXT_PUBLIC_KAKAO_PIXEL_ID;
  if (!PID) return;

  try {
    const kp = (window as unknown as { kakaoPixel?: (id: string) => Record<string, (p: unknown) => void> }).kakaoPixel;
    if (typeof kp !== 'function') return;
    const px = kp(PID);
    if (typeof px.purchase === 'function') {
      px.purchase({
        id: params.id,
        tag: params.name.slice(0, 500),
        value: String(Math.round(params.value)),
        quantity: params.quantity ?? 1,
      });
    }
  } catch {
    /* noop */
  }
}
