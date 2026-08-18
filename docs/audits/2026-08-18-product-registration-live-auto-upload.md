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
