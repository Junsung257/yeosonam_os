# 상품등록 V6 실제 HWP 자동 업로드·고객 공개 검증

## 검증 일시

- 2026-08-18 (Asia/Seoul)
- 대상 배포: `https://www.yeosonam.com`
- 대상 문서: `C:\Users\admin\Downloads\코덱스테스트\[★KE-499특가] 다낭 9월 499 스팟특가 3박4일_0827발권.hwp`
- 모델 정책: DeepSeek-only 등록 경로

## 결과 요약

실제 HWP를 관리자 승인 없이 `POST /api/upload`로 전송하고, 다음 전 과정을 운영 환경에서 완료했다.

`원본 저장 → workflow → 추출/정규화 → revision → snapshot → 모바일 proof → CAS pointer → 고객 페이지 → 상담 CTA`

| 항목 | 결과 |
|---|---|
| 업로드 응답 | `202 Accepted` |
| job | `e168dfac-c0b6-4263-9aba-9a9452c57a90` |
| workflow | `wrun_01M09G9P2Q8D4ZQ7RZ27QM1KQR` |
| terminal state | `done` |
| outcome | `published_degraded` |
| publication state | `converged` |
| blockers | 없음 |
| 고객 package | HTTP 200 |
| 고객 LP | HTTP 200 |
| 모바일 proof | 통과 |
| 상담 CTA | 상담 신청 dialog 정상 동작 |

## 불변 연결 검증

- catalog product: `0a98c18a-bf11-474b-b40d-24e20c7e961a`
- revision: `a4b99893-f09b-43cc-ac86-368727f3ab10`
- snapshot: `c5e81755-0b7b-4bb6-b29a-0c97d9fb7128`
- snapshot hash: `3f11d58c3a6e154c6fc7ffdc5ef91bb0f8d3eae9458ea7124c0e96b4d97100c3`
- renderer build: `082c1b0f`
- proof: `695cadc4-2d4b-4647-88a6-1734f87cd81e`

customer, b2b, partner 세 pointer가 모두 동일한 revision·snapshot을 가리키며, proof의 snapshot hash·renderer build가 snapshot과 일치한다. 이전 renderer 식별자로 생성된 실패 candidate snapshot은 공개되지 않았다.

## 고객 화면 검증

- [상품 상세](https://www.yeosonam.com/packages/5958c8cb-7d0f-4267-8ee2-7bd0f6996c20)
- [모바일 LP](https://www.yeosonam.com/lp/5958c8cb-7d0f-4267-8ee2-7bd0f6996c20)

390×844 Chrome에서 다음을 확인했다.

- 상품명, 기간, 출발일, 가격, 유류할증료 포함 문구
- 대한항공 KE2093/KE2094 및 `시간 미정` 안전 표시
- 호텔의 `알란씨 또는 동급`·지정불가 표현
- DAY 1~4 일정, 포함·불포함, 약관
- 참고 이미지 라벨
- 상세 → LP 이동
- `상담 신청 열기` 클릭 후 날짜·인원·연락처·약관 동의 단계 표시

## 안전 축약 사유

이 상품은 안전하게 고객 공개되었지만 `published_verified`가 아닌 `published_degraded`다.

- 발권기한 조건은 재확인 안내가 필요하다.
- 항공 시각/노선 identity가 확정되지 않아 시간을 추정하지 않고 숨겼다.
- 실제 상품 사진을 확인하지 못해 참고 이미지로만 표시했다.

가격·출발일·통화·상품 자체는 공개 차단 사유가 아니었으며, 불확실한 항공 시각을 임의 생성하지 않은 것이 이번 검증의 핵심이다.

## 한계와 다음 검증

이번 결과는 실제 운영 HWP 1건의 끝단 자동화 증명이다. 전체 원문 corpus의 95% 자동 공개율이나 모든 공급사 양식의 정확도를 의미하지 않는다. 다음 단계는 다음과 같다.

1. 동일한 배포 manifest로 전체 HWP corpus를 재실행한다.
2. 공급사·문서 양식별로 `published_verified`, `published_degraded`, `blocked_action_required`를 집계한다.
3. frozen holdout와 이중 검수 정답지로 가격·출발일·상품경계 exact match를 측정한다.
4. 대표 원문 50건을 같은 모바일 여정으로 무작위 재검증한다.
5. 치명적 오류가 발생한 parser/profile cohort는 자동 차단하고 이전 검증 snapshot pointer로 되돌린다.

따라서 현재 판정은 “실제 고객에게 안전 축약 상품을 자동 공개할 수 있는 경로는 검증 완료”이며, “전체 원문 95% 달성 및 전면 공개 인증 완료”는 아니다.

## 추가 운영 검증 (2026-08-18 15:00 이후)

전체 기존 상품 재처리를 중단하지 않고, 자동 backfill을 25건 단위로 실행하여 최신 workflow 버전과 고객 공개 결과를 다시 확인했다.

| 항목 | 실측 |
|---|---:|
| `travel_packages` 대상 | 992 |
| backfill ledger 등록 | 861 |
| backfill terminal | 796 |
| backfill 진행 중 | 65 |
| 고객 채널 `published` 상품(중복 채널 제외) | 8 |
| `published` channel pointer | 22 |
| 고객 URL HTTP 200·가격·CTA 확인 | 통과 |

추가로 두 가지 운영 결함을 수정하고 배포했다.

- 내부 스키마가 PostgREST에 노출되지 않은 환경에서 공급사 profile이 없다는 이유로 workflow가 실패하지 않도록 generic resolver fallback을 적용했다.
- 동일 원문이 병렬 처리될 때 DeepSeek critical-fact 예약이 `in-flight`로 실패하지 않도록 기존 호출 완료를 잠시 기다린 후 durable 결과를 재사용하게 했다.

최신 배포는 `dpl_FqdRpgCxZRggcwDAF7PPRC6MPncu`이며 `https://www.yeosonam.com`에 연결되어 있다. 최신 재처리 결과에서 supplier profile 접근 오류와 provider in-flight 오류는 새로 발생하지 않았고, 남은 차단은 과거 일정·판매가 부재·가격/일정 관계 불명확·실제 상업조건 충돌·proof/DB 일관성 오류로 분류된다.

Supabase 보안 advisor에는 내부 등록 스키마의 일부 테이블이 RLS 정책 없이 운영되는 경고와 기존 공개 스키마의 별도 보안 경고가 남아 있다. 내부 테이블은 service-role 전용으로 운용 중이지만, 정책을 정하지 않은 상태에서 RLS를 일괄 활성화하면 worker가 막힐 수 있으므로 별도 보안 작업으로 처리해야 한다.

## 최신 코드 버전 재처리 확인

공급사 profile fallback 및 DeepSeek single-flight 대기 수정 후 workflow 버전을 `product-registration-v6-workflow-27`로 올려 이전 실패 결과와 최신 실행을 분리했다. 첫 25건 재처리 결과는 다음과 같다.

- 19건은 차단 사유가 남았고 6건은 진행 중이다.
- 이전의 `PGRST106` 내부 스키마 노출 오류와 `CRITICAL_FACT_PROVIDER_CALL_IN_FLIGHT` 오류는 최신 27번 실행에서 재발하지 않았다.
- 현재 27번 실행의 차단은 과거 출발, 노옵션·선택관광 충돌, 상품 식별 모호, 판매가 관계 미확정, 교통 출발일 누락처럼 원문 또는 업무 판단이 필요한 항목으로만 남아 있다.
- 기존 26번 결과는 자동 backfill cron이 27번으로 순차 재처리하도록 두었고, 기존 고객 공개 상품은 pointer를 유지한다.

## 추가 검증·v32 배포 (2026-08-18 17:00 이후)

추가 재검증에서 다음 두 가지 실제 오류를 확인하고 순방향 수정했다.

- `479,000`과 9% 커미션의 역산 과정에서 generated `selling_price`가 1원 어긋나는 경우가 있어, 호환 projection이 정해진 작은 범위에서 parity를 확인하도록 보완했다. 일치하지 않으면 여전히 차단한다.
- V4 revision이 `needs_review`인 상품도 V6의 핵심 evidence·claim·모바일 proof를 통과한 `published_degraded` 경로에서는 안전하게 `verified`로 승격하도록 publication gate를 맞췄다. `published_verified`나 핵심 정보 미확정에는 적용하지 않는다.

이 변경은 각각 `product-registration-v6-workflow-30`, `31`, `32`로 분리 배포했고, 로컬 type-check·핵심 테스트·Vercel production build를 통과했다. v31 재처리 10건에서는 시스템 오류 없이 과거 일정 6건, 상품 식별 모호 2건, cohort 증거 미완료 2건으로 모두 안전 종결됐다. v32에서 source-proof eligibility 함수는 실제 `needs_review` revision 2건에 대해 `published_degraded` 조건과 핵심 증거 검사를 통과하는 것을 확인했다.

현재 공개 중인 5개 상품의 `/packages`·`/lp` 고객 URL 10개는 모두 HTTP 200으로 응답했고, DB proof에는 가격·항공·약관·CTA·이미지·hydration 오류 없음이 기록돼 있다. 전체 고객 공개 상품은 기존 pointer를 유지하고, 아직 v32로 전량 재처리 중이므로 전체 95% 인증은 완료하지 않았다.

추가로 `travel_packages`에 과거 레거시 상태가 `active/published`로 남아 있으나 customer publication pointer가 없는 2건을 발견했다. 실제 `/packages/{id}`와 `/lp/{id}`는 둘 다 `상품을 찾을 수 없습니다`를 반환해 고객 노출은 차단되어 있었다. 이는 레거시 상태 정리 대상이며, pointer 없는 상품을 고객에게 노출하지 않는 현재 reader fail-closed 계약은 정상 작동했다.
