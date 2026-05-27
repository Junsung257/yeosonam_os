# 재해 복구 (Disaster Recovery) — 운영 가이드

> 마지막 업데이트: 2026-05-27

## 1. Supabase DB 백업 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| Point-in-Time Recovery (PITR) | ✅ 활성화 | Supabase Pro plan($25/월)에 기본 포함. 7일간의 PITR 윈도우 보장. |
| Daily Snapshot | ✅ 자동 | Supabase에서 매일 자동 생성, 30일 보관. |
| Weekly Archive | ✅ 자동 | Supabase에서 매주 자동 생성, 1년 보관. |
| 코드 저장소 | ✅ Git (GitHub) | 모든 코드는 Git으로 관리, GitHub에 원격 백업. |

**확인 방법**: Supabase 대시보드 → Project Settings → Database → Backups

## 2. 복구 절차

### 2.1 DB 장애 시 복구 (PITR)

```bash
# Supabase CLI로 PITR 복구
supabase db restore --project-id ixaxnvbmhzjvupissmly --target-time "2026-05-27 10:00:00 UTC"
```

또는 Supabase 대시보드 → Database → Backups → Restore에서 날짜/시간 선택.

### 2.2 마이그레이션 롤백

최근 마이그레이션은 `supabase/migrations/`에서 역순으로 실행:

```bash
# 최근 마이그레이션 확인
ls -lt supabase/migrations/ | head -5

# 특정 마이그레이션까지 롤백
supabase migration repair --status reverted <target-migration>
```

**주의**: DROP TABLE / DROP COLUMN이 포함된 마이그레이션은 롤백 시 데이터 손실이 발생할 수 있습니다.

### 2.3 전체 재해 복구 시나리오

1. **DB만 손실**: PITR로 가장 가까운 시점 복구
2. **애플리케이션 코드 손실**: `git checkout <last-deployed-tag>` + `npm ci` + `npm run build`
3. **전체 인프라 손실**:
   - Supabase: 대시보드에서 PITR로 새 프로젝트 복원
   - Vercel: Git 연결 재설정 → 자동 배포
   - 환경 변수: Vercel 대시보드에 설정된 값 사용 (`.env.prod`는 placeholder만 있음)

## 3. 주간 백업 검증 (GitHub Actions)

`.github/workflows/disaster-recovery.yml` 워크플로우가 수동 트리거로 설정되어 있습니다.

**실행 방법**:
1. GitHub 저장소 → Actions → "Disaster Recovery Validation" → "Run workflow"
2. 결과는 Artifacts에서 다운로드 가능

**검증 항목**:
- 백업 스케줄 적시성 확인
- 최근 마이그레이션 롤백 가능성 분석
- RTO/RPO 목표 달성 여부
- 데이터 정합성 검사

## 4. RTO / RPO 목표

| 서비스 | RTO (복구 시간) | RPO (데이터 손실 허용) |
|--------|-----------------|----------------------|
| Database | 15분 | 5분 |
| Application (Vercel) | 5분 | 0분 |
| Static Assets | 2분 | 0분 |

## 5. 비상 연락처

- **Supabase 장애**: Supabase Status Page (https://status.supabase.com)
- **Vercel 장애**: Vercel Status Page (https://www.vercel-status.com)
- **GitHub**: Git 저장소(GitHub)에 항상 최신 코드 유지

## 6. 참고

- PITR은 Supabase Pro plan 이상에서만 사용 가능
- 복구 테스트는 분기 1회 수동 실행 권장 (`.github/workflows/disaster-recovery.yml` 수동 트리거)
- `.env.prod`에 실제 시크릿이 없으므로, Vercel 환경 변수가 유실되지 않도록 주의
