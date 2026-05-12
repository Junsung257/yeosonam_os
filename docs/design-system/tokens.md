# 디자인 토큰 (Design Tokens) — 여소남 OS

> **SSOT:** `tailwind.config.js` 의 `theme.extend` + `src/app/globals.css` 의 `:root` CSS 변수.
> 본 문서는 그 두 파일이 정의하는 토큰의 **사용 가이드**다. 토큰을 추가/변경하면 본 문서도 함께 갱신.

---

## 1. 디자인 톤

| 영역 | 톤 | 출처 |
|---|---|---|
| 공개 사이트 (`/`, `/packages`, `/blog` …) | **Toss 톤** — 둥근 모서리(16/12), 부드러운 그림자, 친근 | 기존 유지. 변경 금지. |
| 어드민 (`/admin/**`, `/m/admin/**`) | **Linear/Stripe 톤** — 6/8 모서리, hairline, tabular nums, 여백 컴팩트 | 본 토큰 시스템. |

**원칙:** 어드민은 데이터 밀도 + 키보드 효율 + 정렬·표 우선. 포스터·랜딩처럼 "예쁘게" 만드는 게 아니라 **"읽기·쓰기 빠르게"** 가 1순위.

---

## 2. 폰트

```
font-sans: Pretendard → Inter → system-ui
font-mono: Geist Mono → JetBrains Mono → ui-monospace
```

- 한글 본문은 Pretendard (이미 `next/font/local` 로 박혀있음).
- 영문/숫자는 Pretendard 가 자체적으로 처리하지만, 모노스페이스 표 데이터(주문번호·금액·시각)는 `font-mono` 또는 `.admin-num`/`tabular-nums` 사용.

---

## 3. 어드민 타이포그래피 스케일

Linear/Stripe 6단계 + display·heading 추가:

| 토큰 | 크기 | 행간 | 용도 |
|---|---|---|---|
| `text-admin-2xs` | 11px | 14px | tag, kbd, badge |
| `text-admin-xs` | 12px | 16px | caption, table header, meta |
| `text-admin-sm` | 13px | 18px | compact 밀도 본문, secondary |
| `text-admin-base` | 14px | 20px | **comfortable 본문 (기본값)** |
| `text-admin-md` | 15px | 22px | roomy 본문 |
| `text-admin-lg` | 16px | 24px | section subtitle |
| `text-admin-h3` | 18px / 600 | 24px | 패널/섹션 헤더 |
| `text-admin-h2` | 20px / 600 | 28px | 페이지 서브 헤더 |
| `text-admin-h1` | 24px / 700 | 32px | **페이지 제목 (기본 H1)** |
| `text-admin-display` | 28px / 700 | 36px | KPI 큰 숫자, 빈 상태 일러스트 헤드 |

**금지:** `text-h1`/`text-h2`/`text-body` (공개사이트 토큰)을 어드민에서 쓰지 말 것. 실수로 섞어 쓰면 어드민이 다시 소비자 톤으로 돌아간다.

---

## 4. 색상

### 4-1. 브랜드 (공통)
```
brand          #3182F6   Toss Blue. 액션·링크·포커스링.
brand-light    #EBF3FE   secondary 버튼 배경, 정보 박스
brand-dark     #1B64DA   hover/active
```

### 4-2. 어드민 표면 (Surface)
```
admin.bg          #F8FAFC   페이지 배경 (slate-50 톤)
admin.surface     #FFFFFF   카드·패널·표
admin.surface-2   #F1F5F9   탭 미선택, code, 호버
```

### 4-3. 어드민 경계선 (Border) — 3단계
```
admin.border          #EEF2F6   hairline (표 행, 카드)
admin.border-mid      #E5E7EB   default (input, button outline)
admin.border-strong   #CBD5E1   hover/focus emphasis
```

### 4-4. 어드민 텍스트 (Text) — 5단계
```
admin.text       #0F172A   본문 (slate-900)
admin.text-2     #334155   보조
admin.muted      #64748B   라벨, 캡션
admin.muted-2    #94A3B8   비활성, placeholder
admin.on-brand   #FFFFFF   브랜드 색 위 텍스트
```

### 4-5. 회계·상태
```
admin.profit   #F04452   양수 (한국 주식 관행 — 빨강)
admin.loss     #3182F6   음수 (파랑)

danger    #F04452 / danger.light  #FFF1F2
success   #04C584 / success.light #E9FAF4
warning   #F59E0B / warning.light #FFFBEB
```

### 4-6. 다크모드
`[data-theme="dark"] .admin-scope` 안의 `--admin-*` 변수만 토글된다. 공개사이트는 라이트 온리 유지. 활성화 방법은 Phase 3 에서 토글 컴포넌트 추가 예정.

---

## 5. Border Radius

| 토큰 | px | 용도 |
|---|---|---|
| `rounded-card` | 16 | 공개사이트 카드 (Toss 톤) |
| `rounded-btn` | 12 | 공개사이트 버튼 |
| `rounded-pill` | 9999 | 칩, 토글 |
| `rounded-admin-xs` | 4 | 어드민 tag, kbd |
| `rounded-admin-sm` | 6 | **어드민 input·button (기본)** |
| `rounded-admin-md` | 8 | 어드민 card·modal |
| `rounded-admin-lg` | 10 | 어드민 dialog·sheet |

---

## 6. Box Shadow

어드민은 hairline + 미세 그림자. **카드 hover 에 큰 그림자 띄우지 말 것** (Toss 톤이 됨).

| 토큰 | 용도 |
|---|---|
| `shadow-admin-xs` | hover 미세 변화 |
| `shadow-admin-sm` | **카드 기본** |
| `shadow-admin-md` | 패널, popover |
| `shadow-admin-lg` | drawer, popover-strong |
| `shadow-admin-xl` | modal, dialog |
| `shadow-admin-focus` | 포커스 링 (브랜드) |
| `shadow-admin-focus-danger` | 포커스 링 (danger) |

레거시 `shadow-card` / `shadow-card-hover` 는 공개사이트 전용. 어드민에서 쓰지 말 것.

---

## 7. Spacing & 행 높이

4px grid 강제 (Tailwind 기본 그대로). 어드민 행 높이만 추가:

| 토큰 | px | 밀도 |
|---|---|---|
| `h-admin-row` | 40 | compact |
| `h-admin-row-comfy` | 48 | **comfortable (기본)** |
| `h-admin-row-roomy` | 56 | roomy / 모바일 |
| `min-h-touch` | 44 | iOS HIG 터치 타깃 |

---

## 8. 데이터 밀도 (Density) 규칙

`.admin-scope[data-density="..."]` 가 페이지 단위로 토글한다. 컴포넌트는 직접 row-height 를 정하지 말고 `.admin-scope` 의 `--admin-row-h` 를 따른다:

```tsx
<table className="admin-data-table">
  {/* 행 높이는 admin-scope 의 data-density 에 따라 자동 변동 */}
</table>
```

---

## 9. 어드민에서 자주 쓰는 패턴

### 9-1. 페이지 컨테이너
```tsx
<div className="admin-scope min-h-screen bg-admin-bg">
  <div className="mx-auto max-w-screen-2xl px-6 py-8">
    <h1 className="text-admin-h1">예약 관리</h1>
    {/* … */}
  </div>
</div>
```

### 9-2. 카드
```tsx
<div className="admin-card p-5">
  <h2 className="text-admin-h3 mb-4">신규 예약 추이</h2>
  {/* … */}
</div>
```

### 9-3. KPI 숫자
```tsx
<span className="text-admin-display font-mono admin-num">₩12,450,000</span>
```

### 9-4. 데이터 표
```tsx
<table className="admin-data-table">
  <thead>
    <tr><th>주문번호</th><th>고객</th><th className="text-right">금액</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><span className="font-mono">#1024</span></td>
      <td>김민수</td>
      <td className="text-right admin-num">₩890,000</td>
    </tr>
  </tbody>
</table>
```

---

## 10. 변경·확장 규칙

1. **새 토큰 추가:** `tailwind.config.js` 와 `globals.css` 양쪽에 동시 추가, 그리고 본 문서 업데이트.
2. **기존 토큰 삭제 금지:** 어드민 페이지 116개에 흩어져 있어 회귀 위험. 필요하면 deprecate 표시 후 두 마이너 버전 뒤 제거.
3. **공개사이트 토큰을 어드민으로 끌어쓰지 말 것:** 톤이 섞이면 디자인 시스템 의미가 없다.
4. **임의의 hex 사용 금지:** `bg-[#fafafa]` 같은 임시 색은 PR 리뷰에서 반려. 토큰을 먼저 정의하고 쓸 것.

---

## 11. 마이그레이션 진행 상황

- [x] **Phase 0** 어드민 전수 감사 (페이지 116, 컴포넌트 41)
- [x] **Phase 1** 토큰 정의 (이 문서)
- [ ] **Phase 2** Primitive 컴포넌트 정비 (Button·Input·Modal·Toast·Chip·DataTable·StatusBadge)
- [ ] **Phase 3** 패턴 라이브러리 (DataTable·KPI·Detail Drawer·Form 패턴 + AdminLayout 톤)
- [ ] **Phase 4** 페이지 마이그레이션 (임팩트 순)
- [ ] **Phase 5** Customer Web 톤 정합

자세한 진행 상태는 본 디렉터리의 `progress.md` (Phase 4 진입 시 생성) 에서 추적.
