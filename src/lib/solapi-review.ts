import { sendReviewRequestAlimtalk } from '@/lib/kakao';

/**
 * Solapi 리뷰 요청 알림톡 — D+7 자동 발송 모듈
 *
 * 템플릿 형식은 docs/solapi-review-template-guide.md 준수:
 *   #{고객명} / #{상품명} / #{조사링크} / #{공유링크}
 *
 * 실제 Solapi HTTP 호출은 기존 src/lib/kakao.ts 의 sendReviewRequestAlimtalk 로
 * 일원화한다. 이 모듈은:
 *   - 템플릿 변수 렌더링 (테스트/프리뷰 가능)
 *   - 발송 대상 검증 (전화번호, 상품명 등)
 *   - 발송 결과 정규화 (cron 에서 로그 기록용)
 * 만 담당해 책임 분리한다.
 *
 * 환경변수 (기존 kakao.ts 가 사용):
 *   SOLAPI_API_KEY                — Solapi API Key
 *   SOLAPI_API_SECRET             — Solapi API Secret
 *   KAKAO_CHANNEL_ID              — 카카오 비즈채널 pfId
 *   KAKAO_SENDER_NUMBER           — 발신번호
 *   KAKAO_TEMPLATE_REVIEW_REQUEST — 리뷰 요청 템플릿 ID
 *   NEXT_PUBLIC_BASE_URL          — 링크 베이스 (기본 https://yeosonam.com)
 */

export interface ReviewRequestParams {
  bookingId: string;
  phone: string;
  customerName: string;
  productTitle: string;
}

export interface ReviewRequestRendered {
  to: string;
  templateVariables: {
    고객명: string;
    상품명: string;
    조사링크: string;
    공유링크: string;
  };
  body: string;
}

export interface ReviewRequestResult {
  status: 'sent' | 'skipped' | 'failed';
  templateId: string;
  response: Record<string, unknown>;
  errorMessage?: string;
}

/** docs/solapi-review-template-guide.md §2 본문과 1:1 매핑되는 본문 렌더러 (테스트/감사용). */
export function renderReviewRequestTemplate(params: ReviewRequestParams): ReviewRequestRendered {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/+$/, '');
  const customerName = params.customerName?.trim() || '고객';
  const productTitle = params.productTitle?.trim() || '여행 상품';
  const reviewLink = `${baseUrl}/review/${params.bookingId}`;
  const shareLink = `${baseUrl}/share/new?booking=${params.bookingId}&utm_source=alimtalk&utm_campaign=review_d7`;

  const body =
    `${customerName}님, 여소남입니다.\n\n` +
    `${productTitle} 여행 어떠셨나요?\n\n` +
    `다른 여행자분들께 큰 도움이 되는 소중한 후기를 남겨주세요.\n` +
    `응답자 중 추첨으로 스타벅스 쿠폰을 드립니다.\n\n` +
    `▶ 후기 작성: ${reviewLink}\n` +
    `▶ 친구 공유: ${shareLink}\n\n` +
    `감사합니다.\n여소남 드림`;

  return {
    to: params.phone,
    templateVariables: {
      고객명: customerName,
      상품명: productTitle,
      조사링크: reviewLink,
      공유링크: shareLink,
    },
    body,
  };
}

function isValidKoreanPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return /^01[016789]\d{7,8}$/.test(digits);
}

/**
 * D+7 리뷰 요청 알림톡 발송.
 * 호출 측은 결과의 status 로 solapi_review_sent_log 기록 분기.
 */
export async function sendReviewRequest(params: ReviewRequestParams): Promise<ReviewRequestResult> {
  const templateId = process.env.KAKAO_TEMPLATE_REVIEW_REQUEST || '';

  if (!isValidKoreanPhone(params.phone)) {
    return {
      status: 'skipped',
      templateId,
      response: { reason: 'invalid_phone', phone: params.phone },
      errorMessage: '전화번호 형식 불일치',
    };
  }

  try {
    const result = await sendReviewRequestAlimtalk({
      phone: params.phone,
      name: params.customerName?.trim() || '고객',
      productTitle: params.productTitle?.trim() || '여행 상품',
      bookingId: params.bookingId,
    });

    const r = (result ?? {}) as Record<string, unknown>;
    if (r.skipped) {
      return {
        status: 'skipped',
        templateId,
        response: r,
      };
    }

    return {
      status: 'sent',
      templateId,
      response: r,
    };
  } catch (err) {
    return {
      status: 'failed',
      templateId,
      response: {},
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
