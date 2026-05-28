import { hasSecrets } from '@/lib/secret-registry';

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
 */

// ── 카카오 알림톡 템플릿 ID 중앙 관리 ─────────────────────────────────
// 모든 템플릿 ID는 이곳에서만 환경변수를 읽습니다.
// 새 템플릿 추가 시 KAKAO_TEMPLATE_<NAME> 환경변수 + 템플릿 ID 객체에 추가.
export const KAKAO_TEMPLATES = {
  DEPOSIT:             process.env.KAKAO_TEMPLATE_DEPOSIT ?? '',
  BALANCE:             process.env.KAKAO_TEMPLATE_BALANCE ?? '',
  PREPARATION:         process.env.KAKAO_TEMPLATE_PREPARATION ?? '',
  PASSPORT:            process.env.KAKAO_TEMPLATE_PASSPORT ?? '',
  VOUCHER_ISSUED:      process.env.KAKAO_TEMPLATE_VOUCHER_ISSUED ?? '',
  GUIDEBOOK_READY:     process.env.KAKAO_TEMPLATE_GUIDEBOOK_READY ?? '',
  REVIEW_REQUEST:      process.env.KAKAO_TEMPLATE_REVIEW_REQUEST ?? '',
  MAGIC_LINK:          process.env.KAKAO_TEMPLATE_MAGIC_LINK ?? '',
  AFFILIATE_CELEBRATION: process.env.KAKAO_TEMPLATE_AFFILIATE_CELEBRATION ?? '',
  FREE_TRAVEL_RETARGET:  process.env.KAKAO_TEMPLATE_FREE_TRAVEL_RETARGET ?? '',
  CONCIERGE_CART_RETARGET: process.env.KAKAO_TEMPLATE_CONCIERGE_CART_RETARGET ?? '',
  MILEAGE_EARNED:      process.env.KAKAO_TEMPLATE_MILEAGE_EARNED ?? '',
  MILEAGE_USED:        process.env.KAKAO_TEMPLATE_MILEAGE_USED ?? '',
  MILEAGE_EXPIRING:    process.env.KAKAO_TEMPLATE_MILEAGE_EXPIRING ?? '',
  MILEAGE_EXPIRED:     process.env.KAKAO_TEMPLATE_MILEAGE_EXPIRED ?? '',
  MILEAGE_EVENT:       process.env.KAKAO_TEMPLATE_MILEAGE_EVENT ?? '',
  WELCOME_MILEAGE:     process.env.KAKAO_TEMPLATE_WELCOME_MILEAGE ?? '',
} as const;

function getTemplate(name: keyof typeof KAKAO_TEMPLATES): string {
  return KAKAO_TEMPLATES[name];
}

function isSolapiConfigured() {
  return hasSecrets([
    'SOLAPI_API_KEY',
    'SOLAPI_API_SECRET',
    'KAKAO_CHANNEL_ID',
    'KAKAO_SENDER_NUMBER',
  ]);
}

async function sendAlimtalk(params: {
  to: string;
  templateId: string;
  variables: Record<string, string>;
}) {
  const emptyKeys = Object.entries(params.variables)
    .filter(([, value]) => !String(value ?? '').trim())
    .map(([key]) => key);
  if (emptyKeys.length > 0) {
    console.warn('[알림톡] 비어있는 템플릿 변수 감지:', emptyKeys.join(', '), params.templateId);
  }

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
  // const service = new SolapiMessageService(/* SOLAPI_API_KEY */, /* SOLAPI_API_SECRET */); // 활성화 시 getSecret 사용
  // return service.send({ to: params.to, from: /* KAKAO_SENDER_NUMBER */, kakaoOptions: { pfId: /* KAKAO_CHANNEL_ID */, templateId: params.templateId, variables: params.variables } });

  console.log('[알림톡 수기모드] 발송 대상:', params.to, '| 템플릿:', params.templateId, '| 변수:', params.variables);
  return { skipped: true, mode: 'manual' };
}

/** 어필리에이터 예약 전환 축하 알림
 * 템플릿 예시:
 * 축하합니다 #{인플루언서명}님!
 * 회원님의 추천으로 [#{상품명}] 예약이 발생했습니다.
 * 예약 금액: #{매출액}원 / 예상 수수료: #{수수료}원
 */
export async function sendAffiliateBookingCelebration(params: {
  phone: string;
  affiliateName: string;
  packageTitle: string;
  totalPrice: number;
  commission: number;
}) {
  const templateId = getTemplate('AFFILIATE_CELEBRATION');
  if (!templateId) {
    console.log('[축하 알림] 템플릿 미설정 (수기모드)', params);
    return { skipped: true };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '인플루언서명': params.affiliateName,
      '상품명': params.packageTitle,
      '매출액': params.totalPrice.toLocaleString(),
      '수수료': params.commission.toLocaleString(),
    },
  });
}

/** 계약금 안내 알림톡
 * 템플릿 예시:
 * #{고객명}님, [#{상품명}] 예약번호 #{예약번호} 계약금 안내입니다.
 * 금액: #{계약금}원 / 납부기한: #{납부기한}
 * 계좌: #{계좌번호}
 * 예약 확인: #{예약확인링크}
 */
export async function sendDepositNoticeAlimtalk(params: {
  phone: string;
  name: string;
  packageTitle: string;
  bookingNo: string;
  depositAmount: number;
  dueDate: string;
  account: string;
  portalUrl: string;
}) {
  const templateId = getTemplate('DEPOSIT');
  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_DEPOSIT 환경변수 미설정');
    return { skipped: true };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '상품명': params.packageTitle,
      '예약번호': params.bookingNo,
      '계약금': params.depositAmount.toLocaleString(),
      '납부기한': params.dueDate,
      '계좌번호': params.account,
      '예약확인링크': params.portalUrl,
    },
  });
}

/** 잔금 안내 알림톡
 * 템플릿 예시:
 * 안녕하세요 #{고객명}님, 여소남 여행사입니다.
 * 예약하신 [#{상품명}] 잔금 안내드립니다.
 * 잔금: #{잔금액}원 / 납부기한: #{납부기한}
 * 계좌: #{계좌번호}
 * (선택) #{예약확인링크}
 */
export async function sendBalanceNotice(params: {
  phone: string;
  name: string;
  packageTitle: string;
  balance: number;
  dueDate: string;
  account: string;
  /** 템플릿에 변수 없으면 빈 문자열 전달 가능 */
  portalUrl?: string;
}) {
  const templateId = getTemplate('BALANCE');
  if (!templateId) {
    console.warn('[알림톡] KAKAO_TEMPLATE_BALANCE 환경변수 미설정');
    return { skipped: true };
  }
  const vars: Record<string, string> = {
    '고객명': params.name,
    '상품명': params.packageTitle,
    '잔금액': params.balance.toLocaleString(),
    '납부기한': params.dueDate,
    '계좌번호': params.account,
  };
  if (params.portalUrl) vars['예약확인링크'] = params.portalUrl;
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: vars,
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
  const templateId = getTemplate('PREPARATION');
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
  const templateId = getTemplate('PASSPORT');
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
  guidebookUrl?: string;
}) {
  const templateId = getTemplate('VOUCHER_ISSUED');
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

  if (!templateId) {
    console.warn('[알림톡] VOUCHER_ISSUED 템플릿 미설정 — 수기 발송 필요');
    console.log('[확정서 알림톡 수기모드]', {
      to: params.phone,
      name: params.name,
      product: params.productTitle,
      departure: params.departureDate,
      link: `${baseUrl}/voucher/${params.voucherId}`,
      guidebookUrl: params.guidebookUrl ?? null,
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
      '가이드북링크': params.guidebookUrl ?? `${baseUrl}/voucher/${params.voucherId}`,
    },
  });
}

/**
 * 결제 완료 후 가이드북 링크 발송
 */
export async function sendGuidebookReadyAlimtalk(params: {
  phone: string;
  name: string;
  productTitle: string;
  departureDate: string;
  guidebookUrl: string;
}) {
  const templateId = getTemplate('GUIDEBOOK_READY') || getTemplate('VOUCHER_ISSUED');
  if (!templateId) {
    console.warn('[알림톡] GUIDEBOOK_READY/VOUCHER_ISSUED 템플릿 미설정 — 수기 발송 필요');
    console.log('[가이드북 알림톡 수기모드]', params);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '상품명': params.productTitle,
      '출발일': params.departureDate,
      '가이드북링크': params.guidebookUrl,
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
/**
 * 매직링크 전용 generic 알림톡 — POST-confirm 게이트로 안전.
 *
 * 템플릿 예시 (KAKAO_TEMPLATE_MAGIC_LINK):
 *   안녕하세요 #{고객명}님!
 *   #{안내내용}
 *   👉 #{링크}
 *   * 본인 확인을 위해 링크에서 "확인" 버튼을 눌러주세요.
 */
export async function sendMagicLinkAlimtalk(params: {
  phone: string;
  name: string;
  label: string;
  url: string;
}) {
  const templateId = getTemplate('MAGIC_LINK');
  if (!templateId) {
    console.warn('[알림톡] MAGIC_LINK 템플릿 미설정 — 수기 발송 필요');
    console.log('[매직링크 알림톡 수기모드]', params);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name,
      '안내내용': params.label,
      '링크': params.url,
    },
  });
}

export async function sendReviewRequestAlimtalk(params: {
  phone: string;
  name: string;
  productTitle: string;
  bookingId: string;
}) {
  const templateId = getTemplate('REVIEW_REQUEST');
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

  if (!templateId) {
    console.warn('[알림톡] REVIEW_REQUEST 템플릿 미설정 — 수기 발송 필요');
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


/** 자유여행 견적 리타게팅 알림톡 (Abandoned Cart)
 * #{플래너링크}: 개인화 URL (`…/free-travel?session={세션UUID}`) — 열면 저장된 견적·일정표가 그대로 복원됨.
 *
 * 템플릿 예시:
 * #{고객명}님, #{목적지} 여행 견적이 아직 남아있어요!
 * 링크를 누르면 아까 보신 항공·호텔·액티비티 견적 화면으로 바로 갈 수 있어요.
 * 👉 이어서 보기: #{플래너링크}
 */
export async function sendFreeTravelRetarget(params: {
  phone: string;
  name?: string;
  destination: string;
  plannerUrl: string;
}) {
  const templateId = getTemplate('FREE_TRAVEL_RETARGET');
  if (!templateId) {
    console.log('[자유여행 리타게팅] FREE_TRAVEL_RETARGET 템플릿 미설정 — 수기 모드', params.phone, params.destination);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '목적지': params.destination,
      '플래너링크': params.plannerUrl,
    },
  });
}

/** 컨시어지 장바구니 이탈 리타게팅 알림톡 */
export async function sendConciergeCartRetarget(params: {
  phone: string;
  name?: string;
  itemCount: number;
  cartUrl: string;
}) {
  const templateId = getTemplate('CONCIERGE_CART_RETARGET');
  if (!templateId) {
    console.log(
      '[컨시어지 장바구니 리타게팅] CONCIERGE_CART_RETARGET 템플릿 미설정 — 수기 모드',
      params.phone,
      params.itemCount,
    );
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '상품수': String(Math.max(1, params.itemCount)),
      '장바구니링크': params.cartUrl,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 마일리지 알림톡 템플릿 (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════════

/** 마일리지 적립 안내 (결제 완료 시) */
export async function sendMileageEarnedAlimtalk(params: {
  phone: string;
  name?: string;
  earnedAmount: number;
  balance: number;
  bookingRef?: string;
}) {
  const templateId = getTemplate('MILEAGE_EARNED');
  if (!templateId) {
    console.log('[마일리지 적립] 템플릿 미설정 — 수기 모드', params.phone, params.earnedAmount);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '적립금액': params.earnedAmount.toLocaleString(),
      '잔액': params.balance.toLocaleString(),
      '예약번호': params.bookingRef || '',
    },
  });
}

/** 마일리지 사용 확인 (예약 생성 시) */
export async function sendMileageUsedAlimtalk(params: {
  phone: string;
  name?: string;
  usedAmount: number;
  balance: number;
  bookingRef?: string;
}) {
  const templateId = getTemplate('MILEAGE_USED');
  if (!templateId) {
    console.log('[마일리지 사용] 템플릿 미설정 — 수기 모드', params.phone, params.usedAmount);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '사용금액': params.usedAmount.toLocaleString(),
      '잔액': params.balance.toLocaleString(),
      '예약번호': params.bookingRef || '',
    },
  });
}

/** 마일리지 소멸 예정 (D-30 / D-7) */
export async function sendMileageExpiringSoonAlimtalk(params: {
  phone: string;
  name?: string;
  expiringAmount: number;
  expireDate: string;
  daysLeft: number;
}) {
  const templateId = getTemplate('MILEAGE_EXPIRING');
  if (!templateId) {
    console.log('[마일리지 소멸예정] 템플릿 미설정 — 수기 모드', params.phone, params.expiringAmount);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '소멸금액': params.expiringAmount.toLocaleString(),
      '소멸일': params.expireDate,
      '남은일수': String(params.daysLeft),
    },
  });
}

/** 마일리지 소멸 완료 */
export async function sendMileageExpiredAlimtalk(params: {
  phone: string;
  name?: string;
  expiredAmount: number;
}) {
  const templateId = getTemplate('MILEAGE_EXPIRED');
  if (!templateId) {
    console.log('[마일리지 소멸완료] 템플릿 미설정 — 수기 모드', params.phone, params.expiredAmount);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '소멸금액': params.expiredAmount.toLocaleString(),
    },
  });
}

/** 마일리지 이벤트 안내 */
export async function sendMileageEventAlimtalk(params: {
  phone: string;
  name?: string;
  eventTitle: string;
  eventDescription: string;
  eventUrl?: string;
}) {
  const templateId = getTemplate('MILEAGE_EVENT');
  if (!templateId) {
    console.log('[마일리지 이벤트] 템플릿 미설정 — 수기 모드', params.phone, params.eventTitle);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '이벤트명': params.eventTitle,
      '이벤트내용': params.eventDescription,
      '이벤트링크': params.eventUrl || '',
    },
  });
}

/** 웰컴 마일리지 안내 */
export async function sendWelcomeMileageAlimtalk(params: {
  phone: string;
  name?: string;
  mileageAmount: number;
}) {
  const templateId = getTemplate('WELCOME_MILEAGE');
  if (!templateId) {
    console.log('[웰컴 마일리지] 템플릿 미설정 — 수기 모드', params.phone, params.mileageAmount);
    return { skipped: true, mode: 'manual' };
  }
  return sendAlimtalk({
    to: params.phone,
    templateId,
    variables: {
      '고객명': params.name || '고객',
      '마일리지금액': params.mileageAmount.toLocaleString(),
    },
  });
}
