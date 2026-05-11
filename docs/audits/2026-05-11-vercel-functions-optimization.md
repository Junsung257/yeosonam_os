# Vercel Functions 성능 실측·최적화 (2026-05-11 ~)

## 배경

- `vercel.json` `functions` 객체가 51개로 한계(50) 초과 → 24개로 정리 (`-26 redundant, -1 to route export`)
- 24개 중 **19개가 300s + 1024MB** (heavy AI cron) — 추측이 아니라 실측으로 정당화해야 함
- 가드 박음: [db/audit_vercel_functions_count.js](../../db/audit_vercel_functions_count.js)

## 목표

heavy 19개 cron의 실제 p50/p95 실행시간 + 메모리 peak을 측정해서:
- **maxDuration**: 실제 p99 × 1.5 이상으로만 (현재 300s가 과대했는지 확인)
- **memory**: p99 메모리 × 1.3 이상으로만 (1024MB가 과대했는지 확인)

## 측정 대상 (Tier S — 19개)

```
agent-executor, auto-publish-loop,
blog-publisher, blog-learn, blog-scheduler, blog-regenerate-zero-click,
card-news-refine, card-news-seasonal,
daily-marketing, design-archetype-update,
embed-products,
ig-trend-miner, threads-trend-miner, trend-topic-miner, topical-rebuild,
sync-engagement,
mrt-hotel-ranking,
post-travel-reels,
rag-incremental
```

## 측정 방법 (3가지 중 택1)

### A. Vercel Dashboard (UI, 가장 빠름)

1. Vercel 대시보드 → 프로젝트 → **Observability → Functions**
2. 각 함수별 **p50 / p95 / p99 Duration** + **Memory peak** 확인
3. 최소 7일치 데이터 (cron 빈도가 weekly인 것 있음)

### B. Vercel MCP / CLI (자동화 가능)

```powershell
# 특정 함수 로그 (최근 100개)
vercel logs --json --since 7d <deployment-url> | jq '.[] | select(.path | contains("/api/cron/blog-publisher")) | {duration, memory}'
```

또는 Vercel MCP `get_runtime_logs` 사용 (Claude Code에서 직접).

### C. Sentry Performance (이미 깔려있음)

1. Sentry → Performance → Transactions
2. `GET /api/cron/<name>` 트랜잭션 필터
3. p95 duration + memory 태그(있다면) 확인

## 측정 후 의사결정 표

| 측정 결과 | 액션 |
|----------|------|
| p99 < 60s + memory < 256MB | glob default(180s)로 흡수 → vercel.json 항목 제거 |
| p99 < 120s + memory < 512MB | maxDuration: 180 (default와 동일 → 제거), 또는 라우트 export로 90 |
| p99 < 200s + memory < 768MB | `{ maxDuration: 240, memory: 768 }` 또는 라우트 export로 240 |
| p99 < 280s + memory ~1024MB | 현 설정 유지 (정당화됨) |
| **p99 ≥ 280s** | **300s 한계에 도달 — 즉시 Vercel Queues/Workflow로 분할 검토** |

## 회수 예상

19개 중:
- 평균적으로 **40~60%가 다운사이즈 가능**할 것으로 추정 (특히 trend-miner류, design-archetype-update)
- 그 결과 `vercel.json` entries → 12~15개 수준 (35+ 헤드룸)
- **비용**: Active CPU pricing이라 memory 다운사이즈 비용 영향은 작지만, OOM/Timeout 실패 감소 효과가 큼

## 진행 조건

1. ✅ 가드 박힘 → safe to deploy
2. ⏳ Production 배포 (`vercel --prod`)
3. ⏳ **최소 7일** cron 실행 후 데이터 수집
4. ⏳ 위 측정 방법 A/B/C 중 하나로 데이터 수집
5. ⏳ 이 문서 하단에 측정값 채워서 PR

## 측정 결과 (작성 예정)

| Function | p50 (s) | p95 (s) | p99 (s) | Memory peak (MB) | 권장 설정 | 액션 |
|----------|---------|---------|---------|------------------|----------|------|
| agent-executor | ? | ? | ? | ? | ? | ? |
| auto-publish-loop | ? | ? | ? | ? | ? | ? |
| ... | | | | | | |

---

*작성: 2026-05-11 / 다음 검토: 배포 후 7일 (`+2026-05-18`)*
