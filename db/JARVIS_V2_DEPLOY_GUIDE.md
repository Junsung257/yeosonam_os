# Jarvis V2 배포 가이드 — 클릭 가능한 단계별 매뉴얼 (2026-04-22)

> 대상: 사장님(기술 약함)이 혼자서 따라 할 수 있는 수준.
> 범위: Phase 0~8 코드 완성 → Vercel prod 배포 → 자비스 V2 실제 동작까지.
> 소요: 집중해서 1.5~2시간. 중간에 막히면 중단하고 해당 단계 다시 물어봐도 OK.
>
> **원칙**: 한 단계 끝낼 때마다 확인(✅) 섹션을 꼭 체크. 확인 안 되면 다음 단계 가지 말고 물어볼 것.

---

## 📋 전체 흐름 (이 순서로만)

```
[지금 상태] 8개 feature 브랜치 로컬에 커밋 완료, 원격 미푸시
    ↓
1. gh CLI 설치 · 로그인       (5분)
    ↓
2. PR 8개 GitHub 에 생성      (2분)
    ↓
3. 기존 build 이슈 우회        (5~15분)
    ↓
4. Supabase 스테이징 마이그    (10분)
    ↓
5. RAG 인덱싱 (비용 발생 ~$40) (30~60분)
    ↓
6. Vercel prod 배포            (10분)
    ↓
7. RLS 활성화 (선택)           (5분)
    ↓
[완성] 자비스 V2 운영 시작
```

---

## 1. gh CLI 설치 · 로그인 (5분, 비용 $0)

### 왜 필요?
GitHub 에 PR 8개를 터미널에서 자동 생성하려면 `gh` 명령어가 필요. 수동으로 웹에서 만들 수도 있지만 8개라 귀찮음.

### Step 1-A. 설치
**Windows PowerShell** 을 **관리자 권한** 으로 열고:
```powershell
winget install GitHub.cli
```

설치 끝나면 **터미널을 완전히 닫고 새로 열기** (PATH 반영).

### Step 1-B. 로그인
```powershell
gh auth login
```

질문에 답:
- `? What account do you want to log into?` → **GitHub.com** 선택 (Enter)
- `? What is your preferred protocol for Git operations?` → **HTTPS** 선택
- `? Authenticate Git with your GitHub credentials?` → **Y**
- `? How would you like to authenticate GitHub CLI?` → **Login with a web browser** 선택
- 8자리 코드가 나옴 → 브라우저 자동 열림 → 코드 붙여넣고 로그인 승인

### ✅ 확인
```powershell
gh auth status
```
`✓ Logged in to github.com as 여소남` 같이 나오면 성공.

---

## 2. PR 8개 생성 (2분, 비용 $0)

### 왜 필요?
Claude 가 만든 Phase 0~8 커밋을 GitHub 에 올려야 Vercel 이 자동 배포할 수 있음. 스택형 PR(base 가 서로 연결) 로 8개를 한 번에 만듦.

### Step 2-A. 현재 상태 확인
**Git Bash** (PowerShell 아님) 에서 프로젝트 폴더 이동:
```bash
cd /c/Users/admin/Desktop/여소남OS
git branch
```
브랜치 목록에 `feature/jarvis-v2-phase2 ~ phase8` 8개 + `feature/self-learning-audit-loop` 보이면 OK.

### Step 2-B. dry-run (실제 변경 없이 계획만 확인)
```bash
bash db/create_jarvis_v2_prs.sh --dry-run
```
에러 없이 "━━━ 완료 ━━━" 까지 나오면 OK.

### Step 2-C. 실제 실행
```bash
bash db/create_jarvis_v2_prs.sh
```
각 브랜치가 `git push -u origin` 으로 올라가고, 그 다음 `gh pr create` 가 8번 실행됨.

중간에 `[y/n]` 물으면 **Y** Enter.

### ✅ 확인
```bash
gh pr list
```
PR 8개가 목록에 나오면 성공. GitHub 웹에서도 확인 가능:
- `https://github.com/<당신-유저네임>/<레포이름>/pulls`

### 💡 문제 생기면
- **"permission denied"** → `gh auth login` 다시 실행, 해당 repo 에 write 권한 있는 계정인지 확인
- **"branch already exists on remote"** → 이전에 push 했던 것. 그대로 둬도 PR 은 생성됨
- **스크립트가 중간에 멈춤** → 실행된 단계까지는 진행된 상태. `gh pr list` 로 확인 후 누락된 브랜치만 수동 생성:
  ```bash
  gh pr create --head feature/jarvis-v2-phase8 --base feature/jarvis-v2-phase7 --title "Phase 8" --body "..."
  ```

---

## 3. 기존 build 이슈 우회 (5~15분, 비용 $0)

### 왜 필요?
Vercel 이 자동 배포할 때 `next build` 를 실행. 하지만 V2 와 무관한 기존 페이지 3개 (`/admin/concierge`, `/admin/concierge/transactions/[id]`, `/admin/booking-guide`) 가 build 에 실패함. 이 문제가 해결 안 되면 Vercel prod 배포가 멈춤.

### 원인 후보 (가장 가능성 높은 순서)
1. **`.next` 캐시 오염** — 가장 흔함
2. **`useSearchParams` 를 Suspense 로 감싸지 않음** — `/admin/booking-guide` 해당
3. **특정 import 경로 깨짐** — 드물지만 가능

### Step 3-A. 캐시 초기화 (먼저 시도, 대부분 이걸로 해결)
**Git Bash** 에서:
```bash
cd /c/Users/admin/Desktop/여소남OS
rm -rf .next
rm -rf node_modules/.cache
npm run build
```
(2~5분 걸림)

**결과 A**: `✓ Compiled successfully` + 라우트 목록 표시 + 프롬프트 복귀 → **3단계 완료, 4단계로**
**결과 B**: 여전히 `PageNotFoundError: Cannot find module for page` → Step 3-B 로

### Step 3-B. 문제 페이지 일시 비활성화 (차선책)
해당 3개 페이지를 임시로 build 에서 제외. Vercel 배포가 성공하면 나중에 개별 디버그.

```bash
cd /c/Users/admin/Desktop/여소남OS
mv src/app/admin/concierge src/app/admin/_concierge.disabled
mv src/app/admin/booking-guide src/app/admin/_booking-guide.disabled
npm run build
```

**결과**: build 통과하면:
```bash
git add src/app/admin
git commit -m "chore(build): 임시로 concierge/booking-guide 비활성화 (별도 디버그 필요)"
git push
```

별도 세션에서 해당 페이지들 디버그 → 복원 (`mv src/app/admin/_concierge.disabled src/app/admin/concierge`).

### ✅ 확인
```bash
npm run build
```
맨 끝에 `✓ Generating static pages` + 라우트 테이블 + 정상 종료.

### 💡 더 막히면
Claude 에게 "3단계 Step 3-A/B 해봐도 이 에러 나와" 라고 에러 메시지 붙여서 물어볼 것.

---

## 4. Supabase 스테이징 마이그 실행 (10분, 비용 $0)

### 왜 필요?
자비스 V2 가 쓸 새 테이블 (`jarvis_knowledge_chunks`, `tenant_bot_profiles`, `jarvis_cost_ledger` 등)과 기존 테이블의 `tenant_id` 컬럼 추가. 마이그 5개를 **정확한 순서로** 실행.

### 전제조건
- Supabase 프로젝트 접근 권한 (대시보드 로그인 가능)
- **반드시 스테이징/개발 프로젝트 먼저**. prod 는 검증 후.

### Step 4-A. Supabase 대시보드 열기
브라우저: https://supabase.com/dashboard
→ 여소남 프로젝트 선택
→ 왼쪽 메뉴 **SQL Editor** 클릭
→ 우측 상단 **+ New query** 클릭

### Step 4-B. 마이그 5개 순서대로 실행

**순서 절대 중요** (앞 파일이 뒤 파일의 전제조건):

| 순서 | 파일 경로 | 역할 | 예상 시간 |
|-----|---------|-----|---------|
| 1 | `supabase/migrations/20260423000000_jarvis_v2_request_context.sql` | `set_jarvis_request_context` RPC | 1초 |
| 2 | `supabase/migrations/20260423010000_jarvis_v2_tenant_columns.sql` | P0 테이블 10개에 tenant_id 컬럼 추가 | 5~30초 |
| 3 | `supabase/migrations/20260423020000_jarvis_v2_rls_policies.sql` | RLS 정책 정의 (활성화 안 함) | 2초 |
| 4 | `supabase/migrations/20260424000000_jarvis_knowledge_chunks.sql` | RAG 청크 테이블 + Hybrid Search | 3초 |
| 5 | `supabase/migrations/20260425000000_jarvis_v2_tenant_bot_profiles.sql` | 테넌트 봇 프로파일 + 비용 원장 | 2초 |

**각 파일마다 반복**:
1. Git Bash 에서 파일 내용 보기:
   ```bash
   cat supabase/migrations/20260423000000_jarvis_v2_request_context.sql
   ```
2. 출력 전체를 복사 (마우스 드래그 → Ctrl+C)
3. Supabase SQL Editor 에 붙여넣기
4. 우측 하단 **Run** (또는 Ctrl+Enter) 클릭
5. 하단에 `Success. No rows returned` 또는 `Success. Rows: N` 확인
6. 다음 파일로

### Step 4-C. 검증
SQL Editor 에 다음 붙여넣고 Run:
```sql
-- 4-1) RPC 확인
SELECT current_jarvis_context();

-- 4-2) tenant_id 컬럼 확인
SELECT column_name FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name = 'tenant_id';

-- 4-3) RAG 테이블 확인
SELECT count(*) FROM jarvis_knowledge_chunks;

-- 4-4) 봇 프로파일 테이블 확인
SELECT count(*) FROM tenant_bot_profiles;

-- 4-5) 비용 원장 확인
SELECT count(*) FROM jarvis_cost_ledger;
```

### ✅ 확인
위 5개 쿼리 전부 에러 없이 결과 반환 (0개라도 OK).

### 💡 문제 생기면
- **"relation already exists"** → 이미 실행됨. 무시 가능
- **"relation bookings does not exist"** → 다른 Supabase 프로젝트 보고 있음. 프로젝트 선택 다시 확인
- **"function jarvis_is_platform_admin() does not exist"** → 순서 3번 SQL 이 2번보다 먼저 돌았음. 순서 다시
- **대시보드 못 찾음** → Claude 에게 "Supabase 대시보드 URL 알려줘" 물으면 안내

---

## 5. RAG 인덱싱 (30~60분, 비용 약 $30~50)

### 왜 필요?
자비스가 고객에게 상품/블로그/관광지 추천하려면 DB 콘텐츠를 임베딩 벡터로 변환해야 함. 1회성 비용.

### ⚠️ 비용 경고
- Gemini Flash (contextualize) + Gemini Embedding 호출 비용
- 상품 ~300개 + 블로그 ~100개 + 관광지 ~500개 기준 예상 **약 $30~50 USD**
- 한 번 실행하면 지울 수 없음 (API 호출은 완료된 것)

### Step 5-A. API 키 확인
Git Bash:
```bash
cd /c/Users/admin/Desktop/여소남OS
cat .env.local | grep GOOGLE_AI_API_KEY
```
키 값이 보이면 OK. 없으면 `.env.local` 파일에 추가해야 함.

### Step 5-B. dry-run (실제 호출 없이 5건만 시뮬)
```bash
node db/rag_reindex_all.js --dry-run --limit=5
```
`[dry] package/xxx#0 (1234 chars)` 같은 출력 → 스키마 문제 없음.

### Step 5-C. 작은 규모 실제 테스트 (10건, 약 $0.50)
```bash
node db/rag_reindex_all.js --source=packages --limit=10
```
10개 상품만 인덱싱. 출력:
```
━━━ RAG 재인덱싱 시작 ━━━
[packages] 문서 조회 중...
  10건
  ✓ package/xxx — +3 chunks (0 skipped)
  ...
━━━ 완료 ━━━
문서: 10 · 청크 삽입: 30 · 스킵: 0
```
Supabase SQL Editor 에서:
```sql
SELECT count(*) FROM jarvis_knowledge_chunks WHERE source_type = 'package';
```
0보다 큰 숫자 나오면 성공.

### Step 5-D. 전체 인덱싱 (비용 $30~50)
**여기서 한 번 더 마음 정리. 비용 실제 발생.**
```bash
node db/rag_reindex_all.js
```
30~60분 걸림. 진행 상황이 줄줄 출력됨. 종료 시:
```
━━━ 완료 ━━━
문서: 900 · 청크 삽입: 2700 · 스킵: 0
```

### ✅ 확인
```sql
SELECT source_type, count(*) FROM jarvis_knowledge_chunks GROUP BY source_type;
```
packages/blogs/attractions 각각 수백~수천 행.

### 💡 문제 생기면
- **"API rate limit"** → 잠시 쉬었다 재실행. 스크립트가 이미 처리한 청크는 스킵하고 새 것만 처리 (content_hash dedupe)
- **"ECONNRESET"** → 네트워크 문제. 재실행
- **중간에 멈춤** → Ctrl+C 해도 그때까지 삽입된 건 DB 에 남음. 재실행 시 이어서 처리

---

## 6. Vercel prod 배포 (10분, 비용 $0)

### Step 6-A. PR 머지 순서

GitHub 웹에서 `https://github.com/<user>/<repo>/pulls`:

**반드시 이 순서**:
1. `feature/self-learning-audit-loop` → `main` 먼저 머지
2. `feature/jarvis-v2-phase2` → `feature/self-learning-audit-loop` 였지만, 1번 머지 후엔 base 를 `main` 으로 변경하고 머지
3. 이후 phase3~8 도 같은 방식 (base 를 `main` 으로 바꿔가며 순차 머지)

**간단 대안**: Phase 8 PR 하나만 main 에 머지 (전체 커밋 다 포함). 나머지 7개 PR 은 닫기:
```bash
gh pr close <phase2-pr-number>
gh pr close <phase3-pr-number>
...
gh pr edit <phase8-pr-number> --base main
```
그리고 GitHub 웹에서 Phase 8 PR 머지.

### Step 6-B. Vercel 자동 배포 대기
- `main` 에 머지하면 Vercel 이 알아서 빌드·배포 (2~5분)rm -rf .next
- Vercel 대시보드: https://vercel.com/dashboard → 여소남 프로젝트
- **Deployments** 탭에서 빌드 진행 상황 실시간 보기
- 성공하면 초록색 ✓ + URL 표시

### Step 6-C. 환경변수 설정 (V2 활성화)
Vercel 대시보드 → 프로젝트 → **Settings** → **Environment Variables**:

| Name | Value | Environment |
|------|-------|-------------|
| `JARVIS_ENGINE` | `v2` | Production (체크) |
| `JARVIS_STREAM_ENABLED` | `true` | Production |
| `JARVIS_V2_MAX_ROUNDS` | `5` | Production |

추가 후 **Save** → 자동으로 재배포 트리거됨.

### ✅ 확인
```bash
curl https://<당신의-도메인>/api/jarvis/stream \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"message":"이번 주 예약 현황"}'
```
SSE 스트림이 `event: agent_picked` → `event: text_delta` → ... 순으로 흘러나오면 성공.

웹에서 관리자 봇 페이지:
- `https://<당신의-도메인>/admin/tenants/<tenant-uuid>/bot`
- 봇 프로파일 편집 페이지가 뜨면 성공

### 💡 문제 생기면
- **Vercel 빌드 실패** → 에러 로그 확인 (Vercel Deployments → Failed 빌드 클릭 → Build Logs). V2 이슈라면 Claude 에게, 3단계 이슈라면 복원 필요
- **SSE 응답이 빈 스트림** → `GOOGLE_AI_API_KEY` Vercel 에 설정됐는지 재확인
- **`/admin/tenants/.../bot` 404** → main 에 phase6 이후 커밋이 포함됐는지 확인 (`git log main --oneline | grep phase6`)

---

## 7. RLS 활성화 (선택, 5분, 비용 $0)

### 왜?
테넌트 간 데이터 격리 강제. V1 호환성 보장을 위해 **기본은 꺼져있음**. 파트너 여행사 오픈 시점에 활성화.

### ⚠️ 주의
활성화 후 정책이 잘못되면 **자기 테넌트 데이터도 못 봄**. 반드시 스테이징에서 먼저 테스트.

### Step 7-A. 활성화
Supabase SQL Editor:
```sql
SELECT jarvis_enable_rls();
```

### Step 7-B. 검증
다른 테넌트 계정으로 로그인 시도 → 상대방 예약 못 보는지 확인.

관리자 계정 (JWT 에 `app_metadata.jarvis_role = 'platform_admin'`) 은 전 테넌트 조회 가능해야 함.

### Step 7-C. 문제 생기면 즉시 롤백
```sql
SELECT jarvis_disable_rls();
```
원상 복귀.

### Vercel env 추가
```
JARVIS_RLS_ENABLED=true
```

---

## 🚨 긴급 스위치 (prod 에서 V2 문제 시)

### V2 완전 비활성화
Vercel env 에:
```
JARVIS_STREAM_ENABLED=false
```
→ 자동 재배포 → 클라이언트는 자동으로 V1 (`/api/jarvis`) 로 폴백

### RLS 긴급 해제
```sql
SELECT jarvis_disable_rls();
```

### main 롤백
```bash
git revert <jarvis-v2-머지-커밋-해시>
git push origin main
```
Vercel 자동 재배포.

---

## 📞 각 단계별 Claude 에게 물어보는 방법

막히면 **에러 메시지 + 어느 단계 중이었는지** 붙여서 물어보세요:

```
예:
"3단계 Step 3-A 했는데 이 에러 나와:
  Module not found: Can't resolve '@/lib/content-generator'
어떻게 해?"
```

각 단계 독립적으로 되도록 설계되어 있으니 중간에 막혀도 되돌리기 쉬워요.
