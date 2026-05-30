# 여소남 UX/UI 개선 전략 및 실행 로드맵

- 작성일: 2026-05-30 KST
- 입력 자료:
  - 공개 도메인 감사: `docs/audits/2026-05-30-www-yeosonam-uxui-audit.md`
  - 인증 어드민 감사: `docs/audits/2026-05-30-authenticated-admin-uxui-audit.md`
  - 공개/어드민 Playwright 감사 JSON 및 스크린샷
  - 대형 여행 플랫폼/UX 리서치/논문/오픈 자료

## 1. 결론

여소남의 UX/UI 최적 방향은 "AI 상담이 붙은 패키지 커머스"가 아니라, **검증된 패키지와 목적지 정보를 기반으로 고객의 불안을 줄이고, AI가 비교·요약·견적을 도와주는 신뢰형 여행 의사결정 OS**가 되어야 한다.

현재 가장 큰 병목은 새 기능 부족이 아니라 세 가지다.

1. 모바일 핵심 동선이 깨진다.
2. 가격·일정·리뷰·취소·포함/불포함 같은 신뢰 정보의 구조화가 약하다.
3. 어드민은 기능은 많지만 모바일/테이블/공통 API 오류 때문에 운영자가 빠르게 판단하기 어렵다.

따라서 12주 로드맵은 다음 순서가 최적이다.

1. **신뢰 복구:** 깨진 모바일, 500/401/CSP/hydration 오류 제거.
2. **전환 구조화:** 검색·필터·상품 상세·문의 CTA를 여행 구매 기준으로 재설계.
3. **AI 차별화:** 자연어 상담을 상품 탐색/비교/견적서/카톡 전환과 연결.
4. **운영 생산성:** 어드민을 모바일 drawer + 표/카드 하이브리드 + 공통 KPI 체계로 정리.
5. **성장 루프:** 블로그/목적지/소셜 추천/카드뉴스를 "읽을거리"가 아니라 "예약 가능한 여정"으로 연결.

## 2. 외부 벤치마크에서 얻은 원칙

### Baymard: 여행 UX는 일반 쇼핑몰보다 정보 신뢰가 더 중요하다

Baymard의 여행 UX 연구는 여행 숙박/투어 사이트에서 사용자가 편안하게 예약하려면 일반 이커머스보다 더 구체적인 정보와 기능이 필요하다고 본다. 특히 인기 필터, 홈페이지의 강한 검색 진입, 투어 상세 정보, 지도, 외부 리뷰 연결을 핵심 실패 지점으로 제시한다.

여소남 적용:

- `/packages` 필터를 "지역/가격" 중심에서 "출발월, 항공사, 노팁/노옵션, 골프, 가족, 효도, 쇼핑 적음, 한국어 가이드, 호텔 등급"으로 확장.
- 상품 상세에 "일정/포함/불포함/취소/추가비용/리뷰/지도/상담"을 고정된 순서로 제공.
- 홈 첫 화면은 단순 인기 상품보다 "어디/언제/누구와/예산" 검색을 더 명확히 만든다.

### Expedia/Klook: 소셜 영감은 예약 가능한 상품으로 바로 이어져야 한다

Expedia Unpack '25는 Instagram/TikTok에서 본 여행을 예약으로 연결하는 One-Click Trips를 주요 흐름으로 제시한다. Klook Travel Pulse는 14개 시장 7,000명 이상 조사에서 79%가 소셜 미디어 추천 기반으로 활동/숙소/식사를 예약한 경험이 있다고 밝혔다.

여소남 적용:

- 블로그/카드뉴스/인플루언서 링크는 "콘텐츠 조회"에서 끝나면 안 된다.
- 모든 콘텐츠에 `추천 상품`, `같은 목적지 최저가`, `단체 견적`, `카톡 상담`을 문맥형 CTA로 붙인다.
- 카드뉴스는 공유용 이미지가 아니라 `share/card-news/[id] -> 상품 상세/AI 상담/카톡` 전환 퍼널로 본다.

### Airbnb: 숙소를 넘어 경험·서비스를 묶는 방향

Airbnb 2025 Summer Release는 Services, Experiences, redesigned app을 전면에 내세웠다. 핵심은 여행자가 숙박만 예약하는 것이 아니라 현지 서비스와 경험까지 한 흐름에서 고른다는 점이다.

여소남 적용:

- 패키지 상세에 "선택 경험"을 붙인다: 골프 라운딩, 마사지, 쇼핑 제외 옵션, 가족 액티비티, 단독 차량.
- 목적지 페이지는 정보 허브가 아니라 "지역별 경험 카탈로그"가 되어야 한다.
- AI 컨시어지는 항공/호텔/액티비티를 한 장바구니로 묶는 흐름을 유지하되, 모바일부터 정상화해야 한다.

### Booking.com/Google: 초개인화와 AI 추천은 기본 기대치가 되고 있다

Booking.com은 2026 여행 예측에서 29,000명 이상, 33개 국가/지역 조사 기반으로 여행이 더 개인화되고 실험적인 방향으로 간다고 밝혔다. Google은 Search/Maps/Gemini에 여행 계획 기능을 붙여 사진, 리뷰, 지도, 저장/공유까지 연결하고 있다.

여소남 적용:

- AI 추천은 "무엇이든 물어보세요"보다 "50대 부부 효도 여행", "부산 출발 골프", "노쇼핑 가족여행", "단체 20명 워크샵" 같은 의도 칩으로 시작해야 한다.
- AI 결과는 대화만 보여주지 말고 비교표, 추천 이유, 제외 이유, 예상 추가비용, 상담 CTA로 구조화한다.
- AI 톤은 너무 과장하지 않는다. 2025 GenAI 여행 플래닝 실험은 긍정적 톤이 더 긴 프롬프트를 유도할 수 있음을 보였지만, 여행 구매에서는 신뢰/검증/근거가 더 중요하다.

### 논문/리서치: 투명성과 압박 메시지는 균형이 필요하다

가격 투명성 연구는 패키지 가격 공개가 항상 단순히 구매 의도를 높이는 것은 아니며, 고객의 지각된 힘/맥락에 따라 반응이 달라질 수 있음을 보인다. 반면 다크패턴 연구는 가격 속임수, 감정 조작, 오해 유도, UI 조작이 신뢰와 예약 의도를 낮춘다고 보고한다. 희소성 메시지는 예약 의도에 영향을 주지만 과도하면 신뢰를 해친다.

여소남 적용:

- "마감 임박"은 실제 재고/출발일/좌석/가격 변동 근거와 함께 써야 한다.
- 가격은 `기본가`, `필수 추가`, `선택 추가`, `현지 지불 가능성`을 분리한다.
- "최저가" badge는 산식/조건이 불명확하면 쓰지 않는다.

## 3. 현재 여소남의 UX/UI 진단

### 고객 공개 사이트

강점:

- 홈에 상품, 목적지, 카톡, AI, 단체 문의 진입이 이미 있다.
- 패키지 상세에는 날씨 적합도, 한국인 인기도, 가격, 상담 CTA 등 차별화 재료가 있다.
- 목적지/블로그/카드뉴스/제휴 링크가 있어 콘텐츠 커머스 전환 구조를 만들 수 있다.

문제:

- 모바일 `/concierge`가 깨져 핵심 AI 상담 사용이 어렵다.
- `/destinations/[city]` 일부 500으로 목적지 허브 신뢰가 무너진다.
- 홈/패키지 목록에 H1 부재.
- 모바일 하단 네비, 플로팅 카톡, 상품 상세 예약바가 서로 충돌한다.
- 패키지 목록 첫 화면에 이미지 fallback이 약하고 지구본 placeholder가 반복된다.
- 블로그 에디터 픽 카드는 장식 텍스트와 제목이 겹쳐 읽기 신뢰가 떨어진다.
- 단체 견적은 대화형 구조는 좋지만 첫 입력을 유도하는 빠른 선택지가 부족하다.

### 어드민

강점:

- 기능 범위는 넓다: 예약, 고객, 결제, 상품, 관광지, 마케팅, 블로그, AI, 정산.
- 대시보드는 KPI와 승인 대기/경고판 구조가 이미 있다.
- 상품 관리 테이블은 운영자가 필요한 액션 버튼이 풍부하다.

문제:

- 모바일 어드민은 공통 사이드바 때문에 대부분의 화면이 절반 이상 잘린다.
- 로그인 후에도 공통 admin API 401이 반복된다.
- `/admin/marketing/command-center`, `/admin/marketing/system-health`는 프로덕션 404.
- `/admin/packages`, `/admin/tax` hydration 오류.
- bookings/packages/blog/settlements 등 표가 페이지 전체를 밀어내 overflow를 만든다.
- 추천 shortcut/header가 모바일 폭 정책 없이 전체 화면을 늘린다.

## 4. 고객 행동 기반 우선순위

### 4-1. 고객은 먼저 "갈 수 있나"를 본다

여행 구매에서 고객의 첫 질문은 상품명보다 다음이다.

- 내 출발지에서 가능한가?
- 언제 출발하는가?
- 총 얼마인가?
- 쇼핑/옵션/팁이 있는가?
- 부모님/아이/골프/단체에 맞는가?
- 믿을 수 있는가?

따라서 상품 카드 첫 화면 정보는 다음 순서가 좋다.

1. 목적지/테마
2. 출발일/기간/항공
3. 총 가격 범위
4. 핵심 안심 badge: 노팁, 노옵션, 쇼핑 없음, 특급호텔, 단체 가능
5. 검증 근거: 후기, 상담 가능, 운영팀 검수

### 4-2. 고객은 모바일에서 비교하고 카톡으로 확신한다

여소남의 고객층은 고관여 패키지/단체/골프/효도 수요가 많다. 즉 완전 셀프 체크아웃보다 "비교 후 상담" 전환이 더 현실적이다.

핵심 CTA는 두 개로 정리한다.

- `예약 문의하기`: 날짜·인원·출발지 선택 후 상담/예약
- `카톡 상담`: 불확실성 해소

AI 상담은 세 번째 CTA가 아니라, 위 두 CTA를 더 잘 고르게 돕는 중간 레이어가 되어야 한다.

### 4-3. 운영자는 "예쁜 화면"보다 위험/대기/돈을 먼저 봐야 한다

어드민 UX의 기준은 SaaS 생산성이다.

- 오늘 처리해야 할 예약
- 미매칭 입금
- 승인 대기 상품
- 실패한 자동화
- 고객 문의/에스컬레이션
- 정산 리스크

대시보드는 차트보다 action queue가 먼저다. 모바일은 전체 관리보다 "승인/확인/연락/상태 변경" 같은 짧은 액션 중심이어야 한다.

## 5. IA 및 화면 구조 개편안

### 고객 공개 사이트

홈:

- 첫 화면: `어디로 떠날까요?` 검색을 유지하되 `출발지`, `출발월`, `여행 목적`, `예산`을 명시.
- 인기 카테고리: 마감특가/동남아/일본/중국/골프/단체를 유지하되 emoji 의존도를 낮추고 아이콘+텍스트로 정리.
- 인기 패키지: 랭킹 숫자는 badge로 축소하고 상품 정보 위계를 강화.
- 신뢰 구간 추가: 운영팀 검수, 카톡 상담, 실제 출발 가능 상품, 노팁/노옵션 설명.

패키지 목록:

- 모바일 필터는 접힘 기본값.
- 상단에는 `출발월`, `지역`, `여행목적`, `가격` 4개만 노출.
- "더 많은 필터"에 항공사/호텔등급/노쇼핑/노옵션/골프/가족/효도/단체를 제공.
- 이미지 없는 상품은 지역 fallback 이미지 적용.

상품 상세:

- 첫 화면: 이미지, 상품명, 출발 가능 시기, 가격, 핵심 badge, CTA만.
- CTA: 하단 sticky 하나로 통합. `카톡`과 `예약 문의`를 같은 bar 안에 배치.
- 신뢰 정보 순서:
  1. 가격/포함/불포함
  2. 출발일/항공/호텔
  3. 일정 요약
  4. 이런 분께 추천/비추천
  5. 리뷰/상담 후기
  6. 취소/변경/주의사항
  7. 지도/목적지 정보

목적지:

- gradient 카드 대신 실제 대표 이미지 또는 지역별 고유 visual.
- 목적지 상세 500을 먼저 제거.
- 목적지 페이지는 `가이드`, `추천 상품`, `여행 적합 시기`, `준비물`, `카톡 상담`으로 구성.

AI 컨시어지:

- 모바일 레이아웃 P0 수정.
- 검색 전 빈 상태에 추천 프롬프트를 제공:
  - "부산 출발 60대 부모님 효도 여행"
  - "노쇼핑 동남아 가족여행"
  - "20명 단체 워크샵 견적"
  - "3박5일 골프 패키지 비교"
- AI 답변은 대화문보다 카드/표 중심.
- 결과 카드에는 `왜 추천`, `주의할 점`, `추가 비용 가능성`, `상담하기`를 붙인다.

단체 견적:

- 첫 질문 이후 빈 공간을 줄이고 빠른 선택 칩 제공.
- 진행률 0/8은 유지하되, 다음 입력 항목을 크게 보여준다.
- 모바일 입력창은 채팅 버튼과 겹치지 않게 하단 안전 영역을 통합.

블로그/콘텐츠:

- 블로그 글마다 목적지/테마 기반 상품 추천.
- "7분 읽기"보다 "이 글과 맞는 상품 3개"가 더 중요.
- 카드뉴스는 공유 후 바로 상품/상담으로 이동하는 conversion module을 붙인다.

### 어드민

공통 shell:

- 모바일: sidebar drawer.
- 데스크톱: 208px sidebar 유지 가능.
- header/search/recommendation row는 `min-w-0` 적용.
- 모든 page main은 `overflow-x-hidden`, 표 컨테이너만 `overflow-x-auto`.

대시보드:

- 첫 섹션은 `오늘 처리할 일`로 변경.
- KPI는 매출/입금/예약/정산으로 통일하고 산식 tooltip 제공.
- 비활성/0값 카드와 장애/경고 카드를 색상으로 구분.

테이블:

- 데스크톱: 밀도 유지, 내부 스크롤.
- 모바일: 카드 row로 전환.
- 각 row는 `상태`, `고객/상품`, `금액`, `다음 액션`만 노출.

상품 관리:

- 액션 버튼이 너무 많다. `검수`, `수정`, `발행`, `더보기`로 묶는다.
- 마케팅 커버리지는 progress + missing checklist로 보여준다.

예약 관리:

- 모바일에서는 표가 아니라 action queue.
- `미수금`, `정보 누락`, `출발 임박`, `확정 필요` 탭 중심.

## 6. 12주 실행 로드맵

### Phase 0: 1주, 신뢰 복구

목표: 깨진 화면과 콘솔 오류를 먼저 없앤다.

- `/concierge` 모바일 레이아웃 수정.
- `/destinations/[city]` slug/canonical 처리로 500 제거.
- CSP Sentry source 수정.
- `user_actions` 익명 추적 401/RLS 실패 제거.
- 어드민 공통 API 401 원인 수정.
- `/admin/marketing/command-center`, `/admin/marketing/system-health` 404 정리.
- `/admin/packages`, `/admin/tax` hydration 오류 수정.

성공 기준:

- 공개 대표 7개 화면 모바일/데스크톱 screenshot pass.
- 공개 사이트맵 hard error 0.
- 어드민 대표 18개 모바일 overflow 0 또는 의도된 내부 스크롤만 존재.
- 콘솔 error 0을 목표로 하되 외부 차단성 오류는 allowlist 처리.

### Phase 1: 2~3주, 모바일 전환 구조

목표: 고객이 모바일에서 상품을 비교하고 상담으로 넘어갈 수 있게 한다.

- 상품 상세 sticky CTA 통합.
- 하단 네비/카톡 플로팅/예약바 충돌 제거.
- 패키지 목록 모바일 필터 접힘 구조.
- 이미지 fallback 지역별 적용.
- 홈 H1/패키지 H1 보강.
- 단체 견적 빠른 선택 칩.

성공 기준:

- 모바일 상품 상세 CTA 클릭률 +20%.
- 패키지 목록 필터 사용률 측정 가능.
- 카톡 상담 클릭 전환률 기준선 수집.

### Phase 2: 4~6주, 신뢰형 상품 상세/목적지 허브

목표: 상세 페이지가 상담 전 불안을 충분히 줄이도록 만든다.

- 가격/포함/불포함/추가비용 구조화.
- 추천/비추천 고객 유형 추가.
- 리뷰/상담 후기 모듈.
- 목적지별 대표 이미지/지도/시기/준비물/상품 연결.
- 블로그 글 하단에 상품 추천 module.

성공 기준:

- 상품 상세 체류시간 +15%.
- 상세 -> 상담 CTA 전환 +15%.
- 목적지 -> 상품 클릭률 +20%.

### Phase 3: 7~9주, AI 상담 상품화

목표: AI를 독립 페이지가 아니라 탐색/비교/견적 생성 엔진으로 만든다.

- AI 프롬프트 chip 세트.
- AI 추천 결과 카드/비교표.
- AI 답변에서 상품 상세/카톡/단체 견적으로 연결.
- AI 추천 로그를 `intent`, `budget`, `destination`, `party_type`, `conversion`으로 구조화.
- 카톡 상담 전 `AI 요약 카드`를 생성해 상담원이 이어받을 수 있게 한다.

성공 기준:

- AI 상담 시작률 +30%.
- AI 상담 -> 상품 클릭률 기준선 대비 +20%.
- 카톡 상담에 전달되는 고객 의도 필드 80% 이상 자동 채움.

### Phase 4: 10~12주, 어드민 생산성

목표: 운영자가 위험/대기/돈을 빠르게 처리하게 한다.

- 모바일 admin drawer.
- 예약/상품/결제 테이블 카드형 모바일 row.
- 대시보드 action queue.
- 공통 KPI 산식 tooltip.
- 마케팅/콘텐츠/관광지 화면의 bulk action toolbar 정리.

성공 기준:

- 모바일 어드민 대표 화면 overflow 0.
- 예약/상품 승인까지 클릭 수 30% 감소.
- 미매칭 입금 처리 시간 20% 감소.

## 7. 실험 계획

### A/B 1: 상품 상세 CTA

- A: 현재 카톡 플로팅 + 예약바 분리.
- B: 하단 sticky bar 안에 `카톡 상담`, `예약 문의` 통합.
- 지표: CTA 클릭률, 상담 시작률, 이탈률, 오클릭.

### A/B 2: 패키지 카드 정보 위계

- A: 현재 랭킹 숫자 강조.
- B: 출발일/핵심 badge/가격 강조, 랭킹 축소.
- 지표: 카드 클릭률, 상세 도달률.

### A/B 3: AI 컨시어지 첫 화면

- A: 자유 입력 중심.
- B: 의도 chip + 예시 결과 + 자유 입력.
- 지표: 첫 입력률, prompt 길이, 상품 클릭률.

### A/B 4: 희소성 메시지

- A: 마감/특가 badge만.
- B: `남은 좌석/출발일/가격 변동 가능성` 근거 포함.
- 지표: CTA 클릭률, 상담 중 불신/가격 문의 비율.

## 8. 측정 설계

핵심 이벤트:

- `home_search_started`
- `package_filter_applied`
- `package_card_clicked`
- `package_detail_viewed`
- `price_section_viewed`
- `included_excluded_opened`
- `sticky_cta_clicked`
- `kakao_clicked`
- `ai_prompt_started`
- `ai_recommendation_clicked`
- `group_inquiry_step_completed`
- `admin_action_completed`

핵심 KPI:

- 공개 사이트: 상세 도달률, 상담 CTA 클릭률, 카톡 전환률, AI 상담 시작률, 목적지->상품 전환률.
- 상품 상세: CTA 클릭률, 가격/포함정보 조회율, 리뷰 조회율, 이탈률.
- 단체 견적: 첫 입력률, 3단계 완료율, 8단계 완료율, 카톡 전환률.
- 어드민: 처리 대기 건수, 액션 완료 시간, 실패 API 수, 화면별 overflow/콘솔 오류.

## 9. 디자인 원칙

1. 여행 구매는 신뢰가 먼저다. 시각 장식보다 가격/일정/포함/취소/리뷰가 먼저 보여야 한다.
2. 모바일에서는 CTA를 하나의 하단 시스템으로 통합한다.
3. AI는 말풍선보다 결정 보조 UI여야 한다.
4. 희소성/사회적 증거는 실제 데이터에 근거할 때만 쓴다.
5. 어드민은 마케팅 페이지처럼 꾸미지 않는다. 밀도, 스캔, 비교, 반복 액션이 우선이다.
6. 콘텐츠는 읽고 끝나는 글이 아니라 예약 가능한 여정의 입구다.

## 10. 참고 자료

- Baymard Institute, Travel Site UX: 5 Best Practices: https://baymard.com/blog/travel-site-ux-best-practices
- Expedia Group, Unpack '25: https://www.expedia.com/newsroom/unpack-25-the-trends-in-travel-from-expedia/
- Klook Travel Pulse 2025: https://www.klook.com/newsroom/travelpulse-2025-ultimatetherapy/
- Booking.com Travel Predictions 2026: https://news.booking.com/the-era-of-you-bookingcom-predicts-the-top-trends-defining-travel-in-2026-with-individuality-taking-center-stage/
- Airbnb 2025 Summer Release: https://news.airbnb.com/product-releases/airbnb-2025-summer-release/
- Google vacation-planning features coverage, TechCrunch: https://techcrunch.com/2025/03/27/google-rolls-out-new-vacation-planning-features-to-search-maps-and-gemini/
- Chu et al., price transparency of vacation packages, Current Psychology, 2025: https://link.springer.com/article/10.1007/s12144-024-07157-0
- Baldick & Jang, dark patterns in boutique hotel bookings, International Journal of Hospitality Management, 2025: https://www.sciencedirect.com/science/article/abs/pii/S0278431925002270
- Unpacking conflicting evaluations and ambivalence in online hotel booking, Journal of Retailing and Consumer Services, 2025: https://www.sciencedirect.com/science/article/abs/pii/S0969698925000451
- Jirpongopas et al., GenAI tone in online travel planning, arXiv, 2025: https://arxiv.org/abs/2509.14259
- Bencsik & Hajdu, scarcity messaging in online travel booking, 2025: https://real.mtak.hu/231662/
