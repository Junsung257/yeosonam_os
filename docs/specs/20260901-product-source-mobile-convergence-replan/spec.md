# Feature Spec: Supplier Source To Customer Mobile Convergence

## Goal

랜드사 원문에서 만들어진 exact revision과 immutable customer snapshot이 고객 `/packages/{id}`와 `/lp/{id}`에서 같은 판매 사실로 표시되게 한다. 공개·판매중지·미존재 상태, 현재 출발 가능일, 상담 CTA, 배포 source를 하나의 검증 묶음으로 증명한다.

## Success Criteria

- [x] 고객 상세와 LP가 하나의 service-role-only publication reader를 사용한다.
- [x] 공개는 200, 판매중지는 410, 미존재 UUID는 hard 404로 닫힌다.
- [x] 지난 출발일과 가격은 원문 snapshot에 보존하되 현재 재고나 상담 기본값으로 노출하지 않는다.
- [x] 실제 운영 390×844 브라우저에서 제목, 전체 일정, 포함/불포함, 만료 안내, CTA를 확인한다.
- [x] supplier profile, degraded revision promotion, browser proof 실패 분류가 authority 계약을 지킨다.
- [x] strict golden corpus와 관련 회귀 테스트가 wall-clock과 분리돼 재현 가능하다.
- [ ] 최소 10개 공급사/문서군 100건이 critical false publication 0, source-bound fact, deterministic replay 기준을 통과한다.
- [ ] exact release manifest를 대상으로 1→5→20→100 canary와 각 24시간 관찰을 통과한다.

## In Scope

- upload 결과의 source/revision/snapshot/publication 계보
- 고객 상세·모바일 LP·상담 CTA의 동일 snapshot 읽기
- 판매상태와 미존재 route의 fail-closed 처리
- 현재 KST 기준 출발일·가격과 역사적 검수 fixture 시계 분리
- 운영 DB migration, staged production-environment deploy, 실제 모바일 proof
- GitHub/OSS/MCP 도입 후보와 금지 경계

## Out Of Scope

- 검수되지 않은 랜드사 원문의 일괄 자동 공개
- 관광지·호텔·골프 master 자동 생성
- 원문에 없는 가격·날짜·항공·필수비용 추정
- publication freeze 해제 또는 100건 검수 전 전역 자동승인

## Users And Risks

- Primary audience: 고객, 랜드사, 관리자, 제휴 여행사
- Risk tier: Tier 3
- Sensitive surfaces: 운영 DB/RLS, private supplier source, customer publication, multi-tenancy, production deployment

## Open Questions

- [ ] 100건 reviewed corpus의 실제 공급사별 표본 소유자와 검수 일정
- [ ] 사람 정답 UI를 기존 admin으로 확장할지 Label Studio 하나로 통일할지
