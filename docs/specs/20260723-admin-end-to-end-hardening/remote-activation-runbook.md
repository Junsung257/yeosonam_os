# 운영 활성화 런북

로컬 검증과 운영 스키마 검증을 완료한 뒤, 이 런북의 reviewed 순서대로 원격 DB에 적용했다. 이 문서는 재배포·롤백 검토와 사후 인증 감사에 사용한다.

## 적용 대상과 순서

아래 8개 파일을 현재 브랜치와 함께 리뷰한 뒤 타임스탬프 순서로 배포한다.

1. `20260722150310_admin_dashboard_kpi_view_accuracy.sql`
2. `20260722225239_admin_tenant_summary.sql`
3. `20260722225812_admin_marketing_ltv_summary.sql`
4. `20260722230001_admin_operations_kpi_aggregates.sql`
5. `20260722234056_revoke_admin_dashboard_stats_public.sql`
6. `20260722235844_enable_rls_on_policy_backed_tables.sql`
7. `20260723123000_atomic_reviewed_product_approval.sql`
8. `20260723124500_keyword_stats_accuracy.sql`

`supabase db push --linked`를 변경분 확인 없이 실행하지 않는다. 저장소에는 역사적 마이그레이션 타임스탬프 충돌이 있으므로, CI의 reviewed migration 단계에서 위 8개 파일만 현재 운영 기준과 대조해 적용한다.

현재 적용 결과: 위 8개 버전 모두 원격 migration history에 기록됐다. 키워드 통계 파일은 운영에 존재하는 `keyword_performances` 스키마를 기준으로 비용·매출·기간을 매핑해 적용했다. 과거 원격 전용 migration 이력은 변경하지 않았다.

## 적용 전 읽기 전용 확인

```powershell
npx supabase migration list --linked
npm run check:admin-dashboard-activation:ci
npx supabase db advisors --linked --type all --level error --fail-on error
```

기존 운영 마이그레이션이 위 파일보다 앞선 기준으로 반영돼 있고, 새 파일이 미적용인지 확인한다. 운영 데이터 자동 보정, 예약·결제·정산·PII 변경은 이 런북의 범위가 아니다.

## 적용 후 검증

운영 SQL 세션에서 아래를 실행한다.

```sql
SELECT p.proname,
       p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_admin_dashboard_stats',
    'get_admin_badge_counts',
    'get_admin_ai_month_usage_by_provider',
    'get_admin_tenant_summaries',
    'get_admin_marketing_ltv_summary',
    'get_keyword_performance_admin_summary',
    'get_capital_total',
    'get_pending_agent_actions_compact',
    'approve_reviewed_erp_product'
  )
ORDER BY p.proname;
```

기대값은 `prosecdef=false`, `anon_exec=false`, `authenticated_exec=false`, `service_exec=true`다.

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'booking_passengers', 'departing_locations', 'group_rfqs', 'products',
    'rfq_bids', 'rfq_messages', 'tenants', 'vouchers'
  )
ORDER BY c.relname;
```

모든 행의 `relrowsecurity`가 `true`인지 확인한다. 이후 PostgREST 스키마 캐시가 갱신된 다음 인증 쿠키로 실행한다.

```powershell
$env:BASE_URL = 'https://<운영도메인>'
$env:ADMIN_AUDIT_COOKIE = '<관리자 세션 쿠키>'
npm run audit:admin-dashboard -- --strict --json
```

대시보드 감사가 통과한 뒤에만 운영 완료로 표시한다. 실패하면 API 응답 JSON과 누락 RPC를 먼저 확인하고, 운영 데이터 수정 없이 앱 배포를 중지한다.

## 데이터 드리프트 69건

`optional_tours`의 지역 없는 모호 항목은 현재 49개 패키지(총 54개 항목)다. 원문 해시가 실제 원문과 일치하고, 옵션명 주변에 단일 지역 문맥이 있는 26개 항목만 20개 비공개 패키지에 반영했다. 해시 불일치·원문 매칭 실패·복수/no 지역 문맥은 `needs_review`로 유지하며, 공개 상태 패키지에는 자동 수정하지 않는다.

자동 UPDATE는 수행하지 않는다. `npm run repair:optional-tours-region-drift -- --json`는 원문 문맥에서 단일 지역 후보만 제시하며, 기존의 상품 제목·destination 추정 fallback을 제거했다. 실제 반영은 dry-run 결과를 검토한 뒤 `--apply --allow-reviewed-source-repair`를 명시한 별도 승인 단계에서만 수행하며, 미해결 항목이 하나라도 남으면 전체 쓰기를 거부한다. 고객 공개 스냅샷은 이 검수와 immutable snapshot gate를 통과하기 전까지 재발행하지 않는다.

어드민 검수자는 `/admin/products/source-drift`에서 같은 원문 문맥을 확인하고 지역과 메모를 남길 수 있다. API는 공개 상태 상품을 거부하고, 승인 시에도 `optional_tours.region`과 검수 이력만 갱신한다.
