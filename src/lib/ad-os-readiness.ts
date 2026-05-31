export type AdOsReadinessStatus = 'pass' | 'partial' | 'fail';

export type AdOsReadinessItem = {
  id: string;
  label: string;
  benchmark: string;
  status: AdOsReadinessStatus;
  score: number;
  maxScore: number;
  evidence: string;
  nextAction: string;
};

export type AdOsReadinessAudit = {
  score: number;
  maxScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  summary: string;
  items: AdOsReadinessItem[];
};

type BuildAuditInput = {
  mappingCandidates: number;
  keywordCandidates: number;
  liveMappings: number;
  landingBlogs: number;
  publishedBlogs: number;
  trackedClicks: number;
  trackedCtaClicks: number;
  trackedConversions: number;
  trackedConversionValueKrw: number;
  expiringPackages7d: number;
  configuredMonthlyBudgetKrw: number;
  activeBudgetChannels: number;
  integrationStatus: Record<string, boolean>;
  decisionCount: number;
  learningEventCount: number;
  searchTermCandidateCount: number;
  keywordTiers: Record<string, number>;
  keywordPlatforms: Record<string, number>;
  mappingStatuses: Record<string, number>;
};

function statusFromScore(score: number, maxScore: number): AdOsReadinessStatus {
  if (score >= maxScore) return 'pass';
  if (score > 0) return 'partial';
  return 'fail';
}

function item(
  id: string,
  label: string,
  benchmark: string,
  maxScore: number,
  score: number,
  evidence: string,
  nextAction: string,
): AdOsReadinessItem {
  const clamped = Math.max(0, Math.min(maxScore, score));
  return {
    id,
    label,
    benchmark,
    status: statusFromScore(clamped, maxScore),
    score: clamped,
    maxScore,
    evidence,
    nextAction,
  };
}

function boolScore(condition: boolean, maxScore: number): number {
  return condition ? maxScore : 0;
}

function hasAny(record: Record<string, number>, keys: string[]): boolean {
  return keys.some((key) => Number(record[key] || 0) > 0);
}

export function buildAdOsReadinessAudit(input: BuildAuditInput): AdOsReadinessAudit {
  const connectedChannels = Object.values(input.integrationStatus).filter(Boolean).length;
  const hasSearchChannels = Boolean(input.integrationStatus.naver || input.integrationStatus.google);
  const hasLongtail = Number(input.keywordTiers.longtail || 0) > 0;
  const hasNonCore = hasAny(input.keywordTiers, ['mid', 'longtail']);
  const hasLifecycleStates = hasAny(input.mappingStatuses, ['candidate', 'approved', 'testing', 'active', 'winning', 'scaled', 'expired']);

  const items = [
    item(
      'product-feed',
      '상품 Feed 광고 적합성',
      '상품 등록 즉시 목적지·출발지·항공·발권기한·가격·수수료가 광고 판단에 들어와야 함',
      4,
      boolScore(input.keywordCandidates > 0 || input.mappingCandidates > 0, 4),
      `키워드 후보 ${input.keywordCandidates.toLocaleString('ko-KR')}개, 매핑 후보 ${input.mappingCandidates.toLocaleString('ko-KR')}개`,
      '상품별 마진·잔여 좌석·발권기한을 광고 점수에 더 강하게 반영',
    ),
    item(
      'intent-graph',
      '여행 의도 시나리오',
      '다낭 패키지 같은 대키워드가 아니라 부모님·부산출발·항공사·불안해소·비교 의도를 분리',
      4,
      hasNonCore ? 3 : 1,
      `mid ${input.keywordTiers.mid || 0}개, longtail ${input.keywordTiers.longtail || 0}개`,
      '검색 의도 그래프 테이블을 만들고 상품 등록 때 시나리오별 블로그/광고 세트를 자동 생성',
    ),
    item(
      'longtail-mining',
      '초세부 키워드 발굴',
      '50원짜리 초세부 키워드까지 넓게 생성하고 성과로 pruning',
      4,
      boolScore(hasLongtail, 4),
      `longtail 후보 ${input.keywordTiers.longtail || 0}개`,
      '네이버 KeywordTool/구글 historical metrics 결과를 저장해 CPC·검색량 기반 필터링',
    ),
    item(
      'keyword-validation',
      '키워드 비용 검증',
      '플랫폼 API/검색량/경쟁도/예상 CPC로 비싼 대키워드와 저비용 롱테일을 구분',
      4,
      connectedChannels > 0 ? 3 : 1,
      `연동 채널 ${connectedChannels}개`,
      'Google historical metrics 404/토큰 상태를 별도 헬스체크로 분리',
    ),
    item(
      'dedupe',
      '중복·자기경쟁 방지',
      '비슷한 다낭 상품이 많아져도 키워드/랜딩이 서로 입찰 충돌하지 않아야 함',
      4,
      boolScore(input.keywordCandidates > 0, 2),
      'package_id + platform + keyword + match_type unique 기반 후보 저장',
      '목적지·출발지·월·항공사별 canonical owner 규칙 추가',
    ),
    item(
      'blog-gate',
      '블로그 생성 게이트',
      '상품마다 무조건 새 글이 아니라 evergreen hub, 만료 CTA, 상품형 글을 분리',
      4,
      input.publishedBlogs > 0 ? 3 : 0,
      `발행 블로그 ${input.publishedBlogs.toLocaleString('ko-KR')}개`,
      '중복 위험이 큰 상품은 기존 허브 글 업데이트로 라우팅',
    ),
    item(
      'seo-safety',
      '저품질 방지',
      'thin/duplicate/expired content를 noindex, canonical, CTA 교체로 제어',
      4,
      input.expiringPackages7d >= 0 ? 2 : 0,
      `7일 내 발권기한 ${input.expiringPackages7d.toLocaleString('ko-KR')}개`,
      '만료 글 noindex/CTA 교체/대체상품 추천 자동화 연결',
    ),
    item(
      'landing-routing',
      '광고 랜딩 라우팅',
      '검색 의도별 블로그/상품/비교 랜딩을 자동 선택',
      4,
      input.mappingCandidates > 0 || input.liveMappings > 0 ? 3 : 0,
      `매핑 후보 ${input.mappingCandidates.toLocaleString('ko-KR')}개, 라이브 ${input.liveMappings.toLocaleString('ko-KR')}개`,
      '의도별 랜딩 타입 점수표를 추가',
    ),
    item(
      'cta-tracking',
      '블로그 CTA 추적',
      'CTA 클릭이 ad_mapping_id와 연결되어야 함',
      4,
      input.trackedCtaClicks > 0 ? 4 : input.mappingCandidates > 0 ? 2 : 0,
      `CTA 클릭 ${input.trackedCtaClicks.toLocaleString('ko-KR')}건`,
      'CTA 위치/문구/상품 카드별 A/B 키 추가',
    ),
    item(
      'conversion-attribution',
      '예약·매출 귀속',
      '예약 전환과 매출이 광고 키워드·블로그·CTA까지 이어져야 함',
      4,
      input.trackedConversions > 0 ? 4 : input.trackedClicks > 0 ? 2 : 0,
      `전환 ${input.trackedConversions.toLocaleString('ko-KR')}건, 전환가치 ${input.trackedConversionValueKrw.toLocaleString('ko-KR')}원`,
      'booking margin/settlement 기준 공헌이익 ROAS로 확장',
    ),
    item(
      'search-term-harvest',
      '검색어 수확',
      '실제 검색어를 다음 키워드/negative 후보로 되돌려야 함',
      4,
      hasSearchChannels ? 2 : 0,
      hasSearchChannels ? '검색광고 연동 키 일부 존재' : '검색광고 실연동 미확정',
      'search term report 수집 cron과 negative 후보 테이블 추가',
    ),
    item(
      'state-machine',
      '자동화 상태 머신',
      'candidate→approved→testing→active→winning/scaled/paused/expired가 명확해야 함',
      4,
      boolScore(hasLifecycleStates, 4),
      hasLifecycleStates ? '운영 상태값 사용 중' : '상태값 증거 부족',
      '상태 전환별 권한/필수 지표를 DB constraint 또는 서비스 함수로 고정',
    ),
    item(
      'budget-guardrail',
      '예산 가드레일',
      '채널별 월예산·일예산·Max CPC·테스트 손실 한도가 있어야 함',
      4,
      input.configuredMonthlyBudgetKrw > 0 ? (input.activeBudgetChannels > 0 ? 4 : 3) : 0,
      `월 예산 ${input.configuredMonthlyBudgetKrw.toLocaleString('ko-KR')}원, 활성 채널 ${input.activeBudgetChannels}개`,
      'L3 이상 자동집행은 active budget + max test loss + rollback rule이 있을 때만 허용',
    ),
    item(
      'automation-levels',
      '자동화 권한 단계',
      'L0-L5로 AI 추천, 승인형, 소액자동, 최적화, 완전자율을 분리',
      4,
      4,
      'Ad OS ladder가 대시보드에 노출됨',
      '채널별 현재 허용 레벨과 다음 해제 조건 표시',
    ),
    item(
      'external-api',
      '외부 광고 API 실집행',
      '네이버/구글/Meta API를 실제 생성·수정·중지까지 연결',
      4,
      connectedChannels >= 2 ? 3 : connectedChannels === 1 ? 2 : 0,
      `연동 가능 채널 ${connectedChannels}개`,
      '네이버 캠페인/그룹/키워드 생성 guarded endpoint 추가',
    ),
    item(
      'expiry-cleanup',
      '발권기한 만료 정리',
      '발권기한 지난 상품의 광고/CTA 지출을 자동으로 막아야 함',
      4,
      3,
      'expiry-cleanup dry-run API 존재',
      'guarded 모드에서 expired 적용과 대체상품 CTA 교체까지 연결',
    ),
    item(
      'blog-evolution',
      '블로그 진화 학습',
      '이탈·CTA·예약 데이터를 글 업데이트에 반영',
      4,
      input.trackedClicks > 0 || input.trackedCtaClicks > 0 ? 2 : 1,
      `랜딩 클릭 ${input.trackedClicks.toLocaleString('ko-KR')}건`,
      '블로그 버전 테이블과 개선 제안 큐 추가',
    ),
    item(
      'creative-velocity',
      '카드뉴스·소재 속도',
      'Meta/Kakao/Instagram용 서로 다른 소재 변형을 빠르게 테스트',
      4,
      input.integrationStatus.meta ? 2 : 1,
      input.integrationStatus.meta ? 'Meta 키 일부 존재' : '검색광고 중심 단계',
      'Ad OS에서 카드뉴스/소셜 소재 후보를 같은 캠페인 브리프로 생성',
    ),
    item(
      'tenant-scale',
      '테넌트 광고 SaaS 확장성',
      '테넌트별 예산·계정·학습 데이터·권한이 분리되어야 함',
      4,
      1,
      '현재 Ad OS foundation은 공통 운영 중심',
      'tenant_id 컬럼/RLS/계정 연결 모델을 광고 테이블에 확대',
    ),
    item(
      'learning-loop',
      '성과 학습 루프',
      '키워드·랜딩·CTA·상품·마진 결과가 다음 생성에 반영되어야 함',
      4,
      input.decisionCount > 0 ? 2 : 0,
      `최근 판단 로그 ${input.decisionCount.toLocaleString('ko-KR')}건`,
      'winner/loser feature store와 다음 상품 추천 prompt에 성과 요약 주입',
    ),
    item(
      'learning-feedback-applied',
      '학습 신호 반영',
      '클릭/CTA/전환/검색어 신호가 다음 키워드 후보 생성에 실제로 주입되어야 함',
      4,
      input.learningEventCount > 0 ? 4 : input.searchTermCandidateCount > 0 ? 3 : 0,
      `learning_events ${input.learningEventCount.toLocaleString('ko-KR')}건, search_term_candidates ${input.searchTermCandidateCount.toLocaleString('ko-KR')}건`,
      '성과 신호별 승자/제외 키워드 가중치와 landing/CTA lesson을 후보 생성 품질 플래그에 유지',
    ),
    item(
      'explainability',
      'AI 판단 설명성',
      '왜 생성·정지·증액했는지 decision log로 설명 가능해야 함',
      4,
      input.decisionCount > 0 ? 4 : 1,
      `decision_logs ${input.decisionCount.toLocaleString('ko-KR')}건`,
      '판단 로그에 비용/전환/마진 근거 필드를 표준화',
    ),
    item(
      'rollback',
      '롤백·안전 중지',
      '자동 변경을 되돌리거나 즉시 중지할 수 있어야 함',
      4,
      input.decisionCount > 0 ? 2 : 0,
      'before_state/after_state 로그 기반',
      '원클릭 rollback API와 kill switch 추가',
    ),
    item(
      'security-rls',
      '보안/RLS',
      '서비스키 서버 전용, 테넌트별 데이터 분리, 광고 계정 권한 분리',
      4,
      1,
      '일부 광고/attribution 테이블 RLS 점검 필요',
      'RLS advisory 해소와 tenant policy 적용',
    ),
    item(
      'operator-ux',
      '운영자 UX',
      '사장이 예산만 넣고 후보 생성→승인→드라이런→집행을 한 화면에서 이해해야 함',
      4,
      3,
      'Ad OS 단일 허브와 주요 액션 버튼 존재',
      '오늘 할 일, 위험, 승인 대기만 따로 모은 command center 추가',
    ),
    item(
      'dashboard-coverage',
      '대시보드 커버리지',
      '예산·연동·후보·성과·만료·판단 로그가 한 화면에서 보여야 함',
      4,
      3,
      'KPI/가드레일/후보/판단 로그 노출',
      '채널별 ROAS·CPA·마진 추세와 순위 대시보드 연결',
    ),
    item(
      'today-launch',
      '오늘 시범 운영 가능성',
      '외부 키가 있으면 테스트, 없으면 후보/승인/드라이런까지 즉시 운영',
      4,
      input.keywordCandidates > 0 && input.configuredMonthlyBudgetKrw > 0 ? 3 : 1,
      `후보 ${input.keywordCandidates.toLocaleString('ko-KR')}개, 예산 ${input.configuredMonthlyBudgetKrw.toLocaleString('ko-KR')}원`,
      '승인된 후보를 실제 네이버/구글 캠페인 draft로 변환하는 guarded publisher 완성',
    ),
  ];

  const score = items.reduce((acc, row) => acc + row.score, 0);
  const maxScore = items.reduce((acc, row) => acc + row.maxScore, 0);
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const grade = ratio >= 0.9 ? 'A+' : ratio >= 0.8 ? 'A' : ratio >= 0.65 ? 'B' : ratio >= 0.5 ? 'C' : 'D';

  return {
    score,
    maxScore,
    grade,
    summary:
      ratio >= 0.8
        ? '완전자동화로 확장 가능한 골격은 갖췄고, 실집행 API와 학습 루프를 보강하면 L3 이상으로 올라갈 수 있습니다.'
        : '후보 생성과 추적 기반은 시작됐지만, 실집행·학습·테넌트 보안 고리를 더 채워야 합니다.',
    items,
  };
}
