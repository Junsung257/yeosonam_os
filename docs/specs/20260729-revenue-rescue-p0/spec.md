# Revenue Rescue P0 Specification

## Objective

검증된 부산·김해 출발 상품 한 개를 공개할 수 있는 조건을 증명하고, 고객 문의부터
상담·예약·입금·기여이익까지 누락 없이 추적되는 최소 매출 경로를 복구한다.

## In scope

- 현재 `main`, Vercel production, Supabase production의 재현 가능한 기준선
- 크론·광고·콘텐츠·에이전트 외부 mutation 분류 및 안전한 격리
- 확인된 cron 인증, JWT fallback, RLS, PII, 오류 노출, 허위 사회적 증거의 최소 교정
- 익명 고객 공개 경로, 검증된 offer projection, lead·attribution, 운영자 액션 큐
- 세 개의 stacked Draft PR과 각 변경의 rollback·검증 증거

## Out of scope

- DROP TABLE, 기존 데이터 대량 수정·삭제, migration history 재작성
- 실제 광고·콘텐츠 자동 발행, 가격 자동 변경, 자동 지급·정산
- 최신 가격·좌석·공급사 증거가 없는 상품의 production 공개
- 풀 OTA, 대형 SaaS 재설계, 신규 자율 AI 에이전트

## Safety invariants

- production 데이터와 외부 시스템에는 read-only 조사를 기본으로 한다.
- 기존 예약·입금·고객·PII 데이터는 수정하지 않는다.
- 공개 상품은 검증된 snapshot만 읽으며, 증거가 부족하면 `BLOCKED_OFFER_CANDIDATE`로 남긴다.
- 테스트가 통과하지 않은 finding은 `FIXED`로 보고하지 않는다.
- RLS enabled + no policy는 기본 거부로 구분하고 자동으로 정책을 추가하지 않는다.

## Completion criteria

사용자 프롬프트의 P0 완료 조건을 적용한다. 외부 확인이 필요한 가격·좌석 때문에 공개가
막힌 경우에도 후보, 확인 항목, preview 퍼널, lead·attribution·운영 경로는 검증한다.
