/**
 * 관리자 진단용: 알림톡 환경변수·템플릿 변수 매핑 (비밀값 미노출).
 */

export interface KakaoTemplateDiag {
  envKey: string;
  templateIdSet: boolean;
  /** 코드에서 채우는 변수 키(카카오 템플릿과 일치해야 함) */
  variableKeys: string[];
  description: string;
}

export function getKakaoAlimtalkDiagnostics(): {
  solapiReady: boolean;
  solapiMissing: string[];
  channelReady: boolean;
  channelMissing: string[];
  templates: KakaoTemplateDiag[];
} {
  const need = (name: string) => {
    const v = process.env[name];
    return typeof v === 'string' && v.trim().length > 0;
  };

  const solapiKeys = ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET'] as const;
  const channelKeys = ['KAKAO_CHANNEL_ID', 'KAKAO_SENDER_NUMBER'] as const;

  const solapiMissing = solapiKeys.filter(k => !need(k));
  const channelMissing = channelKeys.filter(k => !need(k));

  const templates: KakaoTemplateDiag[] = [
    {
      envKey: 'KAKAO_TEMPLATE_BALANCE',
      templateIdSet: need('KAKAO_TEMPLATE_BALANCE'),
      variableKeys: ['고객명', '상품명', '잔금액', '납부기한', '계좌번호'],
      description: '잔금 안내',
    },
    {
      envKey: 'KAKAO_TEMPLATE_PREPARATION',
      templateIdSet: need('KAKAO_TEMPLATE_PREPARATION'),
      variableKeys: ['고객명', '상품명', '추가준비물'],
      description: '준비물(D-7)',
    },
    {
      envKey: 'KAKAO_TEMPLATE_PASSPORT',
      templateIdSet: need('KAKAO_TEMPLATE_PASSPORT'),
      variableKeys: ['고객명', '만료일'],
      description: '여권 만료 임박',
    },
    {
      envKey: 'KAKAO_TEMPLATE_VOUCHER_ISSUED',
      templateIdSet: need('KAKAO_TEMPLATE_VOUCHER_ISSUED'),
      variableKeys: ['고객명', '상품명', '출발일', '확정서링크', '가이드북링크'],
      description: '확정서 발급',
    },
    {
      envKey: 'KAKAO_TEMPLATE_GUIDEBOOK_READY',
      templateIdSet: need('KAKAO_TEMPLATE_GUIDEBOOK_READY'),
      variableKeys: ['고객명', '상품명', '출발일', '가이드북링크'],
      description: '가이드북 링크(미설정 시 VOUCHER 템플릿으로 폴백 가능)',
    },
    {
      envKey: 'KAKAO_TEMPLATE_REVIEW_REQUEST',
      templateIdSet: need('KAKAO_TEMPLATE_REVIEW_REQUEST'),
      variableKeys: ['고객명', '상품명', '조사링크', '공유링크'],
      description: '만족도 조사',
    },
    {
      envKey: 'KAKAO_TEMPLATE_FREE_TRAVEL_RETARGET',
      templateIdSet: need('KAKAO_TEMPLATE_FREE_TRAVEL_RETARGET'),
      variableKeys: ['고객명', '목적지', '플래너링크'],
      description: '자유여행 이탈 리타게팅',
    },
    {
      envKey: 'KAKAO_TEMPLATE_AFFILIATE_CELEBRATION',
      templateIdSet: need('KAKAO_TEMPLATE_AFFILIATE_CELEBRATION'),
      variableKeys: ['인플루언서명', '상품명', '매출액', '수수료'],
      description: '제휴 예약 축하',
    },
  ];

  return {
    solapiReady: solapiMissing.length === 0,
    solapiMissing: [...solapiMissing],
    channelReady: channelMissing.length === 0,
    channelMissing: [...channelMissing],
    templates,
  };
}
