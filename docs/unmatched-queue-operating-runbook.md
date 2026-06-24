# 미매칭 관광지 큐 운영 기준서

기준일: 2026-06-24

## 결론

`unmatched_activities`는 더 이상 "관광지만 쌓이는 큐"로 보지 않는다. 고객 화면 렌더링을 막을 수 있는 일정 엔티티 리뷰 큐로 운영하되, 대시보드와 정리 작업에서는 아래처럼 나눈다.

- 등록가능 관광지: 기존 관광지 alias 연결 또는 `entity_master_candidates` 후보 큐로 이동
- 비관광 엔티티: 호텔, 식사, 이동은 관광지 후보로 만들지 않고 자동 종결
- 공지/가격/자유시간/표 조각: 자동 무시
- 옵션/쇼핑: 사람 검토
- 후보 마스터: 내부 후보로 묶고, 외부 증거 없이는 고객 공개 관광지를 만들지 않음

## 2026-06-24 처리 결과

- 시작 active pending: 4,055건
- 1차 정리 후: 1,986건
- 최종 처리 후 active pending: 254건
- 최종 `attraction_gap`: 0건
- 남은 254건: `optional_tour` 219건, `shopping` 35건

즉, "등록 가능한 관광지인데 미처리로 남은 큐"는 닫혔고 남은 것은 정책상 수동 판단이 필요한 옵션/쇼핑이다.

## 운영 순서

1. 신규 업로드 저장 단계

   `deterministic parser -> entity classifier -> attraction matcher -> candidate verifier -> human review queue`

   호텔, 식사, 이동, 자유시간, 공지, 가격 조각은 `attraction` 후보로 넣지 않는다.

2. 매일 또는 대량 업로드 후 감사

   ```powershell
   npm run audit:unmatched-queue
   ```

   반드시 확인할 값:

   - `active_pending_queue_split.attraction_gap`
   - `active_pending_queue_split.manual_review`
   - `active_pending_by_category`
   - 최근 cron run의 `401`, timeout 여부

3. 자동 종결 가능한 비관광 엔티티 정리

   먼저 dry-run:

   ```powershell
   npm run repair:unmatched-queue-entities -- --json
   ```

   확인 후 적용:

   ```powershell
   npm run repair:unmatched-queue-entities:apply -- --json
   ```

4. 관광지 후보 최종 처리

   먼저 dry-run:

   ```powershell
   npm run pipeline:unmatched-final -- --json
   ```

   확인 후 적용:

   ```powershell
   npm run pipeline:unmatched-final:apply -- --json
   ```

   이 단계는 기존 관광지 alias 연결, 후보 그룹 생성, 잡음 무시를 처리한다. 고객 공개 관광지는 생성하지 않는다.

5. 후보 검증

   ```powershell
   npx tsx scripts/verify-entity-master-candidates.ts --category=attraction --promotion-status=auto_internal --limit=30 --summary-only --json --prefer-cached-naver
   ```

   결과가 안전하면 `--apply`를 붙여 후보 검증 상태만 반영한다.

6. 내부 비공개 마스터 승격

   ```powershell
   npx tsx scripts/promote-verified-attraction-candidates.ts --limit=30 --json
   ```

   `scanned`가 0이면 아직 실제 생성 대상이 없다는 뜻이다. 억지로 만들지 않는다.

## 금지 원칙

- LLM 판단만으로 고객 공개 관광지를 자동 생성하지 않는다.
- 상품 제목, 공지, 항공 코드, 가격, 준비물, 자유시간, 가이드 안내를 관광지 후보로 만들지 않는다.
- `attraction_gap` 숫자만 보고 전체 큐가 위험하다고 판단하지 않는다. 옵션/쇼핑 수동검토와 분리해서 본다.
- cron이 실패한 상태에서 "프로세스가 있으니 처리됐다"고 보지 않는다. audit 결과와 cron run 결과를 같이 확인한다.

## 외부 연구 기준

현재 방향은 LLM 단독 자동등록이 아니라 데이터 중심 entity resolution이다.

- EDBT 2025 Entity Matching 연구: cross-dataset entity matching은 전처리, blocking, matching 품질이 중요하다. https://openproceedings.org/2025/conf/edbt/paper-224.pdf
- COLING 2025 ComEM: 단순 1:1 LLM 판정보다 비교/선택 전략을 조합하는 방식이 효과적이다. https://aclanthology.org/2025.coling-main.8/
- TravelRAG 관광 지식그래프: 관광지 정보는 knowledge graph 기반 근거가 있어야 환각을 줄일 수 있다. https://www.mdpi.com/2220-9964/13/11/414
- NAACL 2024 entity blocking: 대량 엔티티 처리에서는 blocking과 후보 축소가 핵심 병목이다. https://aclanthology.org/2024.naacl-long.483/

## 장애 판단표

- `attraction_gap > 0`: 관광지 후보 처리 파이프라인을 dry-run 후 적용한다.
- `hotel_nonblocking` 또는 `notice_noise > 0`: classifier/repair 규칙 누락이다.
- cron run에 `401`: self-call 인증 또는 cron secret 전달 문제다.
- cron run에 timeout: route batch 크기 또는 직접 함수 호출 구조를 점검한다.
- `manual_review`만 남음: 자동 처리 완료, 사람이 옵션/쇼핑 정책만 보면 된다.
