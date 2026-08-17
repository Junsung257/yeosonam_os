# Blog stale content, quarantine, merge, removal 런북

## 원칙

`scripts/audit-blog-corpus-v3.ts`, `plan-blog-corpus-disposition.ts`, `quarantine-invalid-blog-pages.ts`, `generate-blog-redirect-plan.ts`는 기본 dry-run입니다. 이번 작업에서는 운영 DB의 status, redirect, noindex를 변경하지 않았습니다.

## action 의미

| action | 처리 |
|---|---|
| KEEP | 대표 URL 유지, claim expiry와 성과만 관찰 |
| REFRESH | 같은 URL에서 material fact를 재검증하고 수정 |
| MERGE | 대표 문서에 유용한 내용을 합치고 원 URL은 301 |
| QUARANTINE | public surface 전체에서 즉시 제외 후 human review |
| NOINDEX | demand/품질 판단 전 색인 제외 후보 |
| REMOVE | 대체 문서가 없고 잘못된 문서는 410 |
| REDIRECT | 교정된 replacement 또는 canonical representative로 301/308 |

## review-blocked 및 HIGH risk

`pending_review`, `in_review`, `rejected`, `changes_requested`는 어떤 public surface에서도 제외합니다. 비자·입국·ESTA/ETA/ETIAS·여권·세관/면세·보험·법률/규제·안전 경보·건강/의료는 `approved`가 없으면 제외합니다.

published+changes_requested 문서는 다음 순서로 사람이 disposition을 확정합니다.

1. 정확히 교정된 replacement가 있으면 대표 URL을 정하고 301 계획을 승인합니다.
2. 대체 문서가 없고 실제로 잘못된 문서면 public 제외 후 410을 승인합니다.
3. 재검토 예정이면 QUARANTINE 상태로 sitemap/RSS/related/indexing에서 제외하고 URL을 새로 만들지 않습니다.

## 안전 실행

```powershell
npm run audit:blog-quality-v3
npm run plan:blog-disposition-v3
npx tsx scripts/quarantine-invalid-blog-pages.ts
```

실제 quarantine은 별도 change window에서 `BLOG_CORPUS_APPLY_CONFIRM=QUARANTINE_REVIEWED_2026_08_11`와 `--apply`가 동시에 있어야 합니다. 먼저 CSV의 `creative_id`, `canonical_target`, `reason`을 두 사람이 검토하고 DB backup/PITR 가능 상태를 확인합니다.

redirect 적용 전에는 내부 링크를 canonical target으로 바꾸고, target이 public eligible인지 확인합니다. 그 다음 sitemap snapshot을 갱신하고 삭제/redirect indexing event를 한 번만 enqueue합니다.

## material update

요금, 시행일, 입국 조건, 운영시간, 노선, 보험 조건, 안전/건강 정보 변경은 `content_modified_at`, `fact_checked_at`, `last_verified_at`, `material_update_reason`을 갱신하는 material update입니다. 띄어쓰기, CSS, 이미지 dimension, 장식 이미지 교체는 cosmetic이며 `dateModified`를 갱신하지 않습니다.
