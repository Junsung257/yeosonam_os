/**
 * 카카오 채널 1:1 채팅 열기
 * — 문의 메시지를 클립보드에 복사 후 채팅창 오픈
 * — 카카오 채널 chat URL은 text 프리필을 지원하지 않으므로 클립보드 방식 사용
 */

const KAKAO_CHANNEL_ID = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_ID || '_xcFxkBG';

/** 쿠키에서 값 읽기 */
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface KakaoChannelParams {
  internalCode?: string;    // 예: PUS-ETC-FUK-03-0007
  productTitle?: string;
  departureDate?: string;   // 예: 2026-05-13
  leadForm?: {
    name?: string;
    phone?: string;
    adults?: number;
    children?: number;
  };
}

/**
 * 카카오 채널 채팅 열기
 * @returns 클립보드에 복사된 메시지 (토스트 표시용)
 */
export async function openKakaoChannel(params?: KakaoChannelParams): Promise<string | null> {
  let message = '안녕하세요! 아래 상품 문의드립니다.\n\n';
  let hasContent = false;

  if (params?.internalCode) {
    message += `상품코드: ${params.internalCode}\n`;
    hasContent = true;
  }

  if (params?.productTitle) {
    message += `상품명: ${params.productTitle}\n`;
    hasContent = true;
  }

  if (params?.departureDate) {
    message += `출발일: ${params.departureDate}\n`;
    hasContent = true;
  }

  if (params?.leadForm) {
    const f = params.leadForm;
    if (f.adults || f.children) {
      const parts: string[] = [];
      if (f.adults) parts.push(`성인 ${f.adults}`);
      if (f.children) parts.push(`소아 ${f.children}`);
      message += `인원: ${parts.join(', ')}\n`;
      hasContent = true;
    }
    if (f.name) {
      message += `이름: ${f.name}\n`;
      hasContent = true;
    }
    if (f.phone) {
      message += `연락처: ${f.phone}\n`;
      hasContent = true;
    }
  }

  // CSR 네비게이션 시 referrer가 홈으로 고정되는 문제 대응 — sessionStorage에서 실제 페이지 URL 읽기
  const pageUrl = sessionStorage.getItem('kakao_referrer') ?? window.location.href;
  if (pageUrl) {
    message += `페이지: ${pageUrl}\n`;
    hasContent = true;
  }

  // 인플루언서/제휴 추천인 코드 (미들웨어가 ?ref= 에서 쿠키로 저장)
  const refCode = getCookie('aff_ref');
  if (refCode) {
    message += `추천인: ${refCode}\n`;
    hasContent = true;
  }

  if (!hasContent) {
    message = '안녕하세요! 여행 상품 문의드립니다.';
  }

  const finalMessage = message.trim();

  // 클립보드에 메시지 복사
  try {
    await navigator.clipboard.writeText(finalMessage);
  } catch {
    // 클립보드 API 실패 시 (HTTP 환경 등) fallback 무시
  }

  // 카카오 채널 채팅 열기 — <a> 태그로 열어야 현재 페이지 URL이 referrer로 전달됨
  // (window.open은 origin만 전달, 카카오 "이전 페이지"에 상품 URL이 안 보임)
  const a = document.createElement('a');
  a.href = `https://pf.kakao.com/${KAKAO_CHANNEL_ID}/chat`;
  a.target = '_blank';
  a.rel = 'noopener';  // noreferrer 제거 — referrer 전달 필요
  a.referrerPolicy = 'unsafe-url'; // cross-origin에서도 full URL 전달 (CSR 환경 대응)
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  return hasContent ? finalMessage : null;
}

/** 카카오 채널 프로필 URL (채팅 없이 프로필만) */
export function getKakaoChannelUrl() {
  return `https://pf.kakao.com/${KAKAO_CHANNEL_ID}`;
}
