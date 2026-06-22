/**
 * 서브 스페셜리스트 레지스트리 — 한 도메인 안에서도 툴/프롬프트를 쪼개기 전 단계의 논리적 분리
 *
 * 규칙:
 * - 각 AgentType 마다 배열 순서 = 우선순위 (앞이 먼저 매칭)
 * - 마지막 항목은 반드시 match: [] (fallback)
 * - match 는 사용자 메시지 전체에 대해 하나라도 통과하면 선택
 */

import type { AgentType } from '../types';

export interface SpecialistDefinition {
  id: string;
  labelKo: string;
  /** 비어 있으면 fallback (해당 도메인 기본 팀) */
  match: RegExp[];
}

export const SPECIALISTS_BY_AGENT: Record<AgentType, SpecialistDefinition[]> = {
  operations: [
    {
      id: 'operations.payment_match',
      labelKo: '입금·미매칭',
      match: [/입금|미매칭|매칭|통장|계좌|송금/i, /unmatched|payment/i],
    },
    {
      id: 'operations.booking_lookup',
      labelKo: '예약 조회·상태',
      match: [/예약|예약번호|B-\d+|booking|status|대기|취소\s*요청/i],
    },
    {
      id: 'operations.customer_crm',
      labelKo: '고객 정보',
      match: [/고객|연락처|전화|이름|CRM|리드/i],
    },
    {
      id: 'operations.default',
      labelKo: '운영 일반',
      match: [],
    },
  ],
  products: [
    {
      id: 'products.compare_rank',
      labelKo: '비교·순위·TOP',
      match: [/비교|1위|TOP|베스트|순위|topsis|가성비/i],
    },
    {
      id: 'products.search_filter',
      labelKo: '검색·필터',
      match: [/검색|필터|목적지|출발|일정|인원|예산|패키지\s*찾/i],
    },
    {
      id: 'products.default',
      labelKo: '상품 일반',
      match: [],
    },
  ],
  finance: [
    {
      id: 'finance.settlement_tax',
      labelKo: '정산·세무',
      match: [/정산|세금|계산서|원천|3\.3|매입/i],
    },
    {
      id: 'finance.revenue_kpi',
      labelKo: '매출·KPI',
      match: [/매출|KPI|실적|수익|캐시/i],
    },
    {
      id: 'finance.default',
      labelKo: '재무 일반',
      match: [],
    },
  ],
  marketing: [
    {
      id: 'marketing.campaign_planner',
      labelKo: '광고 기획',
      match: [/캠페인|기획|타깃|오퍼|퍼널|랜딩\s*구조|campaign|planner|funnel|offer/i],
    },
    {
      id: 'marketing.performance_analyst',
      labelKo: '성과 분석',
      match: [/ROAS|CPA|CTR|CVR|성과|전환율|클릭률|왜\s*떨어|하락|진단|performance|analyst/i],
    },
    {
      id: 'marketing.copywriter',
      labelKo: '카피·소재',
      match: [/카피|후킹|소재|헤드라인|광고문구|문구|creative|copy|headline/i],
    },
    {
      id: 'marketing.search_term_diagnostician',
      labelKo: '검색어·negative 진단',
      match: [/검색어|search\s*term|negative|네거티브|제외\s*키워드|키워드\s*진단/i],
    },
    {
      id: 'marketing.reporter',
      labelKo: '광고주 보고',
      match: [/보고서|리포트|광고주|주간\s*보고|월간\s*보고|report|client\s*summary/i],
    },
    {
      id: 'marketing.card_sns',
      labelKo: '카드뉴스·SNS',
      match: [/카드뉴스|인스타|SNS|카피|광고\s*소재/i],
    },
    {
      id: 'marketing.mileage',
      labelKo: '마일리지·포인트',
      match: [/마일리지|포인트|적립|소멸|등급|뱃지|출석\s*체크/i],
    },
    {
      id: 'marketing.default',
      labelKo: '마케팅 일반',
      match: [],
    },
  ],
  sales: [
    {
      id: 'sales.rfq_group',
      labelKo: '단체·RFQ',
      match: [/RFQ|단체|견적\s*요청|그룹/i],
    },
    {
      id: 'sales.affiliate_influencer',
      labelKo: '제휴·인플루언서',
      match: [/인플루|제휴|커미션|정산\s*인플/i],
    },
    {
      id: 'sales.default',
      labelKo: '세일즈 일반',
      match: [],
    },
  ],
  system: [
    {
      id: 'system.policy_audit',
      labelKo: '정책·감사',
      match: [/정책|감사|로그|권한|설정/i],
    },
    {
      id: 'system.default',
      labelKo: '시스템 일반',
      match: [],
    },
  ],
};
