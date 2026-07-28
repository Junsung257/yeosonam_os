# Marketing Errors

Last updated: 2026-07-25

Marketing automation, Ad OS, campaign actions, external ad-platform writes, card-news distribution, spend guardrails, and marketing dashboard repeated errors.

## ERR-MKT-tracking-false-accept@2026-07-25

- **발견일**: 2026-07-25
- **도메인**: 마케팅 / 유입·전환 추적
- **원문 vs 결과**: `/api/tracking`은 202 성공을 반환했지만 운영 Supabase는 `ad_traffic_logs` INSERT에 400을 반환했고 새 유입은 저장되지 않았다.
- **근본 원인**: 라우트가 DB Promise를 `void`로 버렸고, `src/lib/db/ads.ts`도 Supabase의 반환 `error`를 검사하지 않았다. 운영 스키마에는 코드가 항상 보내는 `gbraid`, `wbraid` 컬럼도 없었다.
- **해결책**: 주요 INSERT/병합을 await하고 DB 오류를 throw한다. 주요 저장 실패는 `accepted:false`, `retryable:true`인 503으로 응답한다. 누락 컬럼은 새 idempotent 보정 마이그레이션으로 추가한다.
- **검증 규칙**: 202는 해당 주요 DB 행이 실제로 저장된 뒤에만 허용한다. 리소스 절약 모드, DB 미설정, 주요 저장 실패를 mock 성공이나 skipped 성공으로 표시하지 않는다.
- **상태**: FIXED_IN_CODE — 운영 적용은 마이그레이션·배포 후 확인.
- **재발 방지**: 추적 준비도 검사는 실제 쓰기 검사를 건너뛰면 pass가 아니라 blocked/partial로 기록한다.

## ERR-MKT-dashboard-fabricated-performance@2026-07-25

- **발견일**: 2026-07-25
- **도메인**: 마케팅 / 관리자 대시보드
- **원문 vs 결과**: 존재하지 않는 `ad_traffic_logs.count` 컬럼을 조회했고, 클릭을 방문의 2%로 추정했으며, 빈 퍼널을 최소 1건으로 보정했다. 광고사 성과 스냅샷이 0건인데도 정상 KPI처럼 보일 수 있었다.
- **근본 원인**: 방문 로그, 내부 귀속 CPC, 광고사 노출·클릭·지출의 데이터 출처가 한 집계에서 섞였고, 미수집 상태가 숫자 0과 구분되지 않았다.
- **해결책**: 광고비·노출·클릭은 `ad_performance_snapshots`만 사용한다. 누락 자료는 `not_collected`로 표시하고, 방문·문의·예약·완납은 실제 행만 센다. 채널은 신선한 점검·외부 계정·발행 가능 증거가 모두 있을 때만 `운영 중`이다.
- **검증 규칙**: 대시보드 회귀 테스트는 미수집 광고비가 `null`, 빈 퍼널이 모두 0, 오래된 채널 점검이 `stale`인지 확인한다.
- **상태**: FIXED.
- **재발 방지**: KPI 산식과 채널 상태 분류는 `src/lib/marketing/operations-dashboard.ts`의 단일 계약을 사용한다.
