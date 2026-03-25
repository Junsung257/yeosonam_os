/**
 * 카카오 알림톡 발송 라이브러리 (Solapi 사용)
 *
 * 사전 준비:
 * 1. 카카오 비즈니스 채널 개설 및 인증
 * 2. Solapi(https://solapi.com) 회원가입 → API Key 발급
 * 3. npm install solapi
 * 4. 알림톡 템플릿 3종 등록 → 카카오 심사 승인 (수일 소요)
 *
 * 환경변수:
 *   SOLAPI_API_KEY=SA...
 *   SOLAPI_API_SECRET=...
 *   KAKAO_CHANNEL_ID=_xxxxx   (pfId, 카카오 비즈채널 ID)
 *   KAKAO_SENDER_NUMBER=0212345678
 *   KAKAO_TEMPLATE_BALANCE=템플릿ID_잔금안내
 *   KAKAO_TEMPLATE_PREPARATION=템플릿ID_준비물안내
 *   KAKAO_TEMPLATE_PASSPORT=템플릿ID_여권만료
 */

function isSolapiConfigured() {
  return !!(
    process.env.SOLAPI_API_KEY &&
    process.env.SOLAPI_API_SECRET &&
    process.env.KAKAO_CHANNEL_ID &&
    process.env.KAKAO_SENDER_NUMBER
  );
}

async function sendAlimtalk(params: {
  to: string;
  templateId: string;
  variables: Record<string, string>;
}) {
  if (!isSolapiConfigured()) {
    console.warn('[알림톡] Solapi 미설정 - 발송 건너뜀 (수기 관리 모드)', params);
    return { skipped: true };
  }

  // TODO: solapi 준비 후 활성화
  // 1. npm install solapi
  // 2. .env.local에 SOLAPI_API_KEY, SOLAPI_API_SECRET, KAKAO_CHANNEL_ID, KAKAO_SENDER_NUMBER 추가
  // 3. 아래 주석 해제
  //
  // const { default: SolapiMessageService } = await import('solapi');
  // const service = new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET);
  // return service.send({ to: params.to, from: process.env.KAKAO_SENDER_NUMBER!, kakaoOptions: { pfId: process.env.KAKAO_CHANNEL_ID!, templateId: params.templateId, variables: params.variables } });

  console.log('[알림톡 수기모드] 발송 대상:', params.to, '| 템플릿:', params.templateId, '| 변수:', params.variables);
  return { skipped: true, mode: 'manual' };
}

/** 잔금 안내 알림톡
 * 템플릿 예시:
 * 안녕하세요 #{고객명}님, 여소남 여행사입니다.
 * 예약하신 [#{상품명}] 잔금 안내드립니다.
 * 잔금: #{잔금액}원 / 납부기한: #{납부기한}
 * 계좌: #{계좌번호}
 */
export async function sendBalanceNotice(params: {
  phone: string;
  name: string;
  packageTitle: string;
  balance: number;
  dueDate: string;
  account: string;
}) {
  const templateId = process.env.KAKAO_TEMPLATE_BALANCE || '';
  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_BALANCE 환경변수 미설정');
    return { skipped: true };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '상품명': params.packageTitle,
      '잔금액': params.balance.toLocaleString(),
      '납부기한': params.dueDate,
      '계좌번호': params.account,
    },
  });
}

/** 준비물 안내 알림톡 (출발 D-7)
 * 템플릿 예시:
 * 안녕하세요 #{고객명}님!
 * [#{상품명}] 출발이 7일 남았습니다.
 * 준비물: 여권, 여행자보험, 환전 #{추가준비물}
 */
export async function sendPreparationGuide(params: {
  phone: string;
  name: string;
  packageTitle: string;
  extras?: string;
}) {
  const templateId = process.env.KAKAO_TEMPLATE_PREPARATION || '';
  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_PREPARATION 환경변수 미설정');
    return { skipped: true };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '상품명': params.packageTitle,
      '추가준비물': params.extras || '',
    },
  });
}

/** 여권 만료 임박 알림톡
 * 템플릿 예시:
 * 안녕하세요 #{고객명}님,
 * 여권 만료일이 #{만료일}로 6개월 이내입니다.
 * 재발급을 미리 준비해 주세요.
 */
export async function sendPassportExpiryNotice(params: {
  phone: string;
  name: string;
  expiryDate: string;
}) {
  const templateId = process.env.KAKAO_TEMPLATE_PASSPORT || '';
  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_PASSPORT 환경변수 미설정');
    return { skipped: true };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '만료일': params.expiryDate,
    },
  });
}

// ─────────────────────────────────────────────────────────────
// B2B-B2C 안심 중개 & Voucher 관련 알림톡
// 환경변수 추가 필요:
//   KAKAO_TEMPLATE_VOUCHER_ISSUED  = 확정서 발급 완료 템플릿 ID
//   KAKAO_TEMPLATE_REVIEW_REQUEST  = 만족도 조사 요청 템플릿 ID
// ─────────────────────────────────────────────────────────────

/**
 * 확정서(Voucher) 발급 완료 알림톡
 *
 * 템플릿 예시:
 * 안녕하세요 #{고객명}님! 🎉
 * [#{상품명}] 여행 확정서가 발급되었습니다.
 * 출발일: #{출발일}
 * 확정서 보기: #{확정서링크}
 *
 * 여소남 안심 제휴 서비스도 확인해보세요!
 * 🔒 여행자 보험 / 유심 구매 링크가 확정서에 포함되어 있습니다.
 */
export async function sendVoucherIssuedAlimtalk(params: {
  phone: string;
  name: string;
  productTitle: string;
  departureDate: string;
  voucherId: string;
}) {
  const templateId = process.env.KAKAO_TEMPLATE_VOUCHER_ISSUED || '';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yesonam.com';

  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_VOUCHER_ISSUED 환경변수 미설정 — 수기 발송 필요');
    console.log('[확정서 알림톡 수기모드]', {
      to: params.phone,
      name: params.name,
      product: params.productTitle,
      departure: params.departureDate,
      link: `${baseUrl}/voucher/${params.voucherId}`,
    });
    return { skipped: true, mode: 'manual' };
  }

  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '상품명': params.productTitle,
      '출발일': params.departureDate,
      '확정서링크': `${baseUrl}/voucher/${params.voucherId}`,
    },
  });
}

/**
 * 여행 종료 후 만족도 조사 + C2C 공유 권장 알림톡
 *
 * 템플릿 예시:
 * 안녕하세요 #{고객명}님! 여소남입니다.
 * [#{상품명}] 여행은 즐거우셨나요? 😊
 * 짧은 만족도 조사에 참여해주시면 다음 여행 할인 쿠폰을 드립니다.
 * 📝 조사 참여: #{조사링크}
 * 📢 여행 후기를 공유하면 친구에게도 여소남 혜택이 전달됩니다!
 * 공유하기: #{공유링크}
 *
 * [스케줄러 호출 시점]: 여행 end_date + 1일 (cron: /api/cron/post-travel)
 */
export async function sendReviewRequestAlimtalk(params: {
  phone: string;
  name: string;
  productTitle: string;
  bookingId: string;
}) {
  const templateId = process.env.KAKAO_TEMPLATE_REVIEW_REQUEST || '';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yesonam.com';

  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_REVIEW_REQUEST 환경변수 미설정 — 수기 발송 필요');
    console.log('[만족도 조사 알림톡 수기모드]', {
      to: params.phone,
      name: params.name,
      product: params.productTitle,
      reviewLink: `${baseUrl}/review/${params.bookingId}`,
      shareLink: `${baseUrl}/share/new?booking=${params.bookingId}`,
    });
    return { skipped: true, mode: 'manual' };
  }

  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '상품명': params.productTitle,
      '조사링크': `${baseUrl}/review/${params.bookingId}`,
      '공유링크': `${baseUrl}/share/new?booking=${params.bookingId}&utm_source=alimtalk&utm_campaign=review`,
    },
  });
}
