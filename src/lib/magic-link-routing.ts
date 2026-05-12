/**
 * 매직링크 액션 타입 → 액션 페이지 URL 매핑.
 * POST-confirm 후 magic-session 쿠키 발급하고 이 URL 로 302 리다이렉트.
 *
 * S2~S5 페이지 신설 시 이 표만 갱신.
 */

import type { MagicActionType, VerifiedToken } from '@/lib/magic-link';

export function actionPageUrlFor(token: VerifiedToken): string {
  switch (token.actionType) {
    case 'booking_portal':
      // S1 시점에는 기존 /trip/[rawToken] 호환 — 다만 magic_action_tokens 경로엔 rawToken 이 없으므로
      // bookingId 가 있으면 어드민 내장 페이지, 아니면 자비스 챗으로 폴백.
      return token.bookingId ? `/m/booking/${token.bookingId}` : `/m/chat/${token.id}`;

    case 'guidebook':
      // 기존 guidebook JWT 페이지와 별도 — 통합 토큰 경로
      return token.bookingId ? `/m/guide/booking/${token.bookingId}` : `/m/chat/${token.id}`;

    case 'payment_balance':
      // S2 신설 예정
      return `/m/pay/${token.id}`;

    case 'itinerary_consent':
      // S3 신설 예정
      return `/m/consent/${token.id}`;

    case 'passport_upload':
      // S4 신설 예정
      return `/m/passport/${token.id}`;

    case 'review_request':
      // S3 신설 예정
      return `/m/review/${token.id}`;

    case 'companion_input':
      // S5 신설 예정
      return `/m/companion/${token.id}`;

    case 'jarvis_session':
      // 자비스 직접 진입 (FAQ·일정안내·상담)
      return `/m/chat/${token.id}`;
  }
}

/** 사용자 노출용 액션 설명 (POST-confirm 페이지 카피) */
export function actionDescriptionFor(actionType: MagicActionType): {
  title: string;
  description: string;
  cta: string;
} {
  switch (actionType) {
    case 'booking_portal':
      return {
        title: '예약 정보 확인',
        description: '예약 상태·일정·자료를 확인하실 수 있습니다.',
        cta: '예약 정보 보기',
      };
    case 'guidebook':
      return {
        title: '가이드북',
        description: '여행에 필요한 자료를 모았습니다.',
        cta: '가이드북 열기',
      };
    case 'payment_balance':
      return {
        title: '잔금 결제 안내',
        description: '잔금 결제를 진행하실 수 있습니다. 결제 정보는 다음 화면에서 다시 한번 확인됩니다.',
        cta: '결제 화면으로',
      };
    case 'itinerary_consent':
      return {
        title: '일정 변경 동의',
        description: '여행 일정에 변동 사항이 있어 동의가 필요합니다.',
        cta: '변경 내용 확인',
      };
    case 'passport_upload':
      return {
        title: '여권 정보 등록',
        description: '출입국 신고에 필요한 여권 정보를 등록해 주세요.',
        cta: '여권 등록 화면으로',
      };
    case 'review_request':
      return {
        title: '여행 후기 작성',
        description: '소중한 여행 경험을 남겨 주세요. 사진과 함께 공유하실 수 있습니다.',
        cta: '후기 남기기',
      };
    case 'companion_input':
      return {
        title: '동반자 정보 입력',
        description: '함께 여행하실 분의 정보를 직접 입력해 주세요.',
        cta: '정보 입력하기',
      };
    case 'jarvis_session':
      return {
        title: '여소남 안내 채팅',
        description: '예약·일정·여행 팁을 자유롭게 물어보실 수 있습니다.',
        cta: '채팅 시작하기',
      };
  }
}
