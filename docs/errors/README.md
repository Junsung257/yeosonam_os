# Repeated Error Registry

Last updated: 2026-06-23

반복 오류 상세를 도메인별로 보관한다. 중앙 진입점은 `db/error-registry.md`이고, 이 폴더는 전체 원인·해결·재발 방지 규칙을 보관한다.

## Files

- [Product registration](product-registration.md)
- [Blog](blog.md)
- [Affiliate](affiliate.md)
- [Settlement / ledger](settlement.md)
- [AI ops](ai-ops.md)
- [Marketing](marketing.md)
- [Common](common.md)

## Operating Rule

- 새 반복 오류는 먼저 해당 도메인 파일에 상세를 추가한다.
- `db/error-registry.md`에는 최근 10건 체크리스트와 도메인 인덱스만 유지한다.
- 일회성 감사 수치와 증거는 `docs/audits/**`에 둔다.
