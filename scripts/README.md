# scripts/ — 자동화 유틸

## 🎯 Visual Regression 자동화 (Option B + A)

### Option B: 승인 = 자동 baseline
- 어드민에서 상품 status 를 `approved` 로 변경하면 → `baseline_requested_at` 자동 설정
- `/register` INSERT 시에도 자동 설정
- GitHub Action `baseline-refresh.yml` 이 **2시간마다** 큐를 처리 → Playwright 로 baseline 생성 → 커밋

### Option A: 일일 회귀 감시
- GitHub Action `visual-regression.yml` 이 **매일 새벽 3시 (KST)** 프로덕션 대상 회귀 검사
- 실패 시: HTML 리포트 artifact + GitHub issue 자동 생성
- Vercel Cron (매일 09:00 KST) `/api/cron/visual-baseline-monitor` — 24h+ 처리 지연 감지 + Slack 알림

## 📁 스크립트 목록

| 파일 | 용도 | 사용 시점 |
|------|------|---------|
| `refresh-baselines.js` | baseline 큐 처리 | 자동 (GitHub Action) / 수동 옵션 |
| `refresh-baselines.ps1` | Windows PowerShell 래퍼 | 로컬 수동 실행 |

## 🔧 사장님 수동 실행 (거의 필요 없음)

```powershell
# 로컬 dev server 상태 대상 큐 처리
PowerShell -File scripts\refresh-baselines.ps1

# 프로덕션 대상 큐 처리
PowerShell -File scripts\refresh-baselines.ps1 -Production

# 어떤 상품 처리될지만 미리보기
PowerShell -File scripts\refresh-baselines.ps1 -DryRun
```

## 🤖 GitHub 보안 설정 (최초 1회)

GitHub repo → Settings → Secrets and variables → Actions → 다음 3개 추가:

| Secret 이름 | 값 | 용도 |
|-----------|---|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` 의 동일 값 | DB 접속 |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` 의 동일 값 | DB 접속 (service role) |
| `PRODUCTION_URL` | `https://yeosonam.com` | 회귀 테스트 대상 URL |

설정 후 Actions → Visual Regression → "Run workflow" 1회 수동 실행해서 권한 확인.

## 📊 흐름도

```
상품 등록/승인
   │
   ├─ DB: baseline_requested_at = NOW()
   │
   ▼
[GitHub Action baseline-refresh, 2h마다]
   │
   ├─ 큐 조회
   ├─ Playwright → baseline 생성
   ├─ git commit + push
   ▼
baseline 갱신 완료
   │
[GitHub Action visual-regression, 1일 1회]
   │
   ├─ Playwright → 프로덕션 대상 회귀 검사
   ├─ 실패 → Issue 생성 + artifact
   ▼
[Vercel Cron visual-baseline-monitor, 1일 1회]
   │
   ├─ 24h+ 처리 지연 감지
   ├─ Slack 알림
```

## ⚠️ 주의 사항

- **Playwright 는 Vercel serverless 에서 실행 불가** (Chromium 바이너리 부재) → GitHub Action 필수
- **GitHub Action 은 15분 이내 완료 권장** — fixtures 수가 많아지면 subset 처리 추가 고려
- **baseline 커밋 자동화**: `baseline-refresh.yml` 이 git push 권한 필요 (`permissions.contents: write`)
