# 멀티 세션 작업 시 충돌 방지 — 디자인 시스템 작업 협약

## 왜 필요한가

여러 Claude 세션이 동시에 같은 프로젝트에서 작업할 때 **stale-cache overwrite** 가 발생한다:
- 세션 A: `tailwind.config.js` 를 읽음 (시점 T1)
- 세션 B: 같은 파일 수정 후 저장 (시점 T2)
- 세션 A: T1 의 캐시 기반으로 다른 부분만 수정해서 저장 (시점 T3) → B 의 변경 사라짐

이게 무서운 이유: **TypeScript 통과 + 시각적으로만 회귀**. `text-admin-text-2` 같은 Tailwind 클래스는 string 이라 컴파일 에러가 나지 않지만 토큰이 정의 안 된 상태면 클래스가 무시되어 화면이 그냥 회귀해버린다. 한 줄도 안 깨뜨리고 디자인 시스템 전체가 무력화될 수 있다.

이미 한 번 일어남 (2026-05-10): 다른 세션이 `tailwind.config.js` 를 Phase 0 원본으로 덮어써서 45페이지 작업이 무음 회귀할 뻔함.

---

## 절대 규칙

### 1. 파일 소유권 (한 세션만 쓸 수 있음)

| 영역 | 한 번에 한 세션만 수정 가능 |
|---|---|
| `tailwind.config.js` | ★ 디자인 시스템 세션 전용 |
| `src/app/globals.css` | ★ 디자인 시스템 세션 전용 |
| `src/components/admin/patterns/**` | ★ 디자인 시스템 세션 전용 |
| `src/components/ui/Button.tsx` `Input.tsx` `Modal.tsx` `Toast.tsx` `Chip.tsx` | ★ 디자인 시스템 세션 전용 |
| `src/components/admin/ui/DataTable.tsx` `StatusBadge.tsx` 등 admin primitive | ★ 디자인 시스템 세션 전용 |
| `src/components/AdminLayout.tsx` | ★ 디자인 시스템 세션 전용 |

### 2. 폴더 분담 (페이지 마이그레이션 시)

| 폴더 | 세션 |
|---|---|
| `src/app/admin/blog/**` | 디자인 세션 (혹은 별도 분담) |
| `src/app/admin/marketing/**` | 디자인 세션 (혹은 별도 분담) |
| `src/app/admin/(나머지)` | 폴더 단위 분담 |

다른 세션이 이미 같은 폴더를 만지고 있으면 **다른 폴더로 이동**.

### 3. 검증 의무

매 세션 시작 전·끝 후 반드시 실행:

```bash
npm run verify:design-system
```

- `verify:tokens` — `tailwind.config.js` 와 `globals.css` 가 admin 토큰을 모두 정의하고 있는지 검증 (덮어써짐 감지)
- `type-check` — TypeScript 통과 확인

---

## 사고 발생 시 복구

### 증상 1: `verify:tokens` 실패

```
❌ tailwind.config.js admin 토큰 — N개 누락
   👉 tailwind.config.js 가 다른 세션에 의해 덮어써졌을 가능성. 즉시 복구 필요.
```

→ `git diff tailwind.config.js` 로 변경 확인 → 마지막 정상 커밋이 있다면 `git checkout HEAD -- tailwind.config.js` → 정상 커밋이 없다면 `docs/design-system/tokens.md` 정의를 참고해 수동 복구.

### 증상 2: 화면이 갑자기 원래 톤으로 돌아간 것 같음

원인 99%: `tailwind.config.js` 가 덮어써짐. `verify:tokens` 부터 실행.

### 증상 3: `text-admin-text-2`, `border-admin-border-mid` 같은 클래스가 작동 안 함

같은 원인. tailwind.config 에 admin.* 키 정의가 사라진 것.

---

## 안전한 워크플로우 (디자인 세션 기준)

```bash
# 세션 시작
git status                               # 작업 트리 깨끗한지 확인
npm run verify:design-system             # 토큰 무결성 + 타입 통과 확인

# 작업 N 페이지 …

# 세션 끝 또는 5~10페이지마다
npm run verify:design-system             # 회귀 없는지 재확인
git status                               # 변경 파일 검토
git add <명시적 파일들> && git commit    # 커밋 (잠금 효과)
```

⚠️ `git add -A` 또는 `git add .` 금지 — 다른 세션이 동시에 만든 임시 파일까지 따라 들어갈 위험.

---

## 다른 세션에 보낼 메시지 (사장님 복붙용)

```
디자인 시스템 마이그레이션이 다른 세션에서 진행 중입니다.
다음 파일은 절대 쓰지 말아주세요 (읽기만 가능):
- tailwind.config.js
- src/app/globals.css
- src/components/admin/patterns/**
- src/components/ui/Button.tsx, Modal.tsx, Input.tsx, Toast.tsx, Chip.tsx
- src/components/admin/ui/DataTable.tsx, StatusBadge.tsx
- src/components/AdminLayout.tsx
- src/app/admin/** (현재 마이그레이션 진행 중)

이 영역에 변경이 필요하면 사장님께 먼저 알려주세요.
다른 영역(예: src/app/api/**, src/lib/**, db/**) 작업은 자유롭게 하셔도 됩니다.
```
