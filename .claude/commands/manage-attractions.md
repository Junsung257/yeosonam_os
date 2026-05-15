---
name: manage-attractions
description: 관광지(attractions) DB·매칭·시딩 관련 작업의 유일한 진입점. 자동 시드 금지·기존 파이프라인 우선 등 ERR-20260418-33 재발 방지 규칙 박제. 관광지·attraction·매칭·시딩 키워드에서 자동 활성화.
allowed-tools: Read, Grep, Glob, Edit, Bash(node db/seed_attractions*)
---

# 🗺️ 관광지(Attractions) 관리 가이드

> **⚠️ [필독] 이 파일은 관광지 관련 작업의 유일한 진입점입니다.**
> 관광지 DB를 건드리기 전 반드시 이 파일을 먼저 Read하세요.
> 여소남 OS는 **이미 관광지 관리 완전 파이프라인**을 갖추고 있습니다. 새로 만들지 마세요.

---

## 🔄 정책 갱신 (2026-05-16 — STRICT SSOT, ERR-XIY 박제)

**사장님 의도 (2달간 반복 지시, feedback_user_intent_is_ssot.md):**
> "이미 attractions 관리에 등록된 거 있잖아. 거기에 매칭만 시키면 되는 거 아니야?
>  같은 키워드 다른 말이 있으면 정규화·alias 추가. 자동 INSERT는 사장님이 안 했음에도
>  AI가 verbatim 라인을 박아 DB 오염 — 절대 금지."

**ERR-XIY-2026-05-16 사고:**
"중국보존건축물중 가장 완전한 서안성벽+함광문유적지박물관" / "당나라 3대 궁전 중의 하나인 흥경궁공원" /
"인도에서 가져온 견전을 보관한 소안탑" / "소수민족 회족의 전통을 엿볼 수 있는 회족거리" 4건이
attractions 테이블에 verbatim 박혀 모바일 카드 오염. 원인: 2026-05-14 자동 시드 허용 정책으로 우회.

### ❌ 절대 금지 (자동 INSERT)

1. **`autoSeedAttraction` 의 호출 자체 금지** — 함수는 함수로 남기되 upload/route.ts 등 등록 파이프라인에서 호출하지 말 것
2. **외부 source(Wikidata/Wikipedia/MRT/하나투어) 자동 시드 금지** — 모두 사장님 어드민 수동 확인 필수
3. **paraphrase 통과했으니 안전" 류 우회 금지** — verbatim 도 paraphrase 흡사하게 통과해 버림 (실제 사고 발생)
4. **`db/seed_XXX_attractions.js` 임시 스크립트 생성 금지** — 변하지 않음
5. **정규식 가드로 verbatim 차단하려 시도 금지** — 새 패턴 무한 추격 게임, 본질 미해결. attractions 자체를 사장님 SSOT로 두면 verbatim 박힐 통로가 없음

### ✅ 허용 (STRICT SSOT)

1. **이미 등록된 attractions 매칭만** — `matchAttraction()`(`attraction-matcher.ts`)이 SSOT 기반 작동
   - exact name / alias / 양방향 substring / keyword split / Hangul fuzzy (threshold 0.78)
   - fuzzy 매칭 시 음역 변형은 `attractions_aliases` 에 자동 누적 (alias 자동 학습)
2. **매칭 실패 = `unmatched_activities` 큐 적재만** — 자동 INSERT 안 함
3. **사장님이 어드민에서 수동 처리:**
   - 기존 attraction 의 표기 변형 → **alias 추가** (정규화)
   - 진짜 신규 → **`/admin/attractions` 직접 등록** (사장님이 하나투어/모두투어 키워드 긁어 입력)
4. **사진 자동 보강** — 사장님이 신규 등록한 attraction 에 한해 Pexels 일괄 자동 (`/admin/attractions` Pexels 일괄 버튼)
5. **설명 자동 보강** — 사장님 등록한 attraction 의 short_desc/long_desc 가 비어 있을 때 CSV 다운로드 → 외부 Claude → 업로드 (사장님 주도)

### 🧠 신규 흐름 (auto-attraction-seeder 호출 제거 후)

```
일정 activity 추출 (extractAttractionCandidates)
  → matchAttraction (SSOT 매칭 시도)
    → ✅ 매칭 성공: mention_count++, alias 자동 학습 (fuzzy 잡힌 변형)
    → ❌ 매칭 실패: unmatched_activities 적재 (status='pending')

사장님 어드민 (/admin/attractions/unmatched):
  → "이건 [기존 attraction] 의 다른 표기" → alias 추가
  → "이건 진짜 신규 관광지" → /admin/attractions 등록
  → "이건 관광지 아님 (식사/이동 등)" → ignored
```

---

## ✅ 올바른 관광지 관리 흐름

### 단계 1: 상품 등록 시 자동 매칭 시도
`/register` 커맨드 → 어셈블러/insert-template가 일정 activity를 `attractions` DB와 **자동 매칭**
- 매칭 성공 → 상품 내 관광지 블록 자동 렌더링
- 매칭 실패 → `unmatched_attractions` 테이블에 **자동 적재** (플래그만)

### 단계 2: 미매칭 관광지 수동 처리
관리자 페이지 방문: **`/admin/attractions/unmatched`** ([src/app/admin/attractions/unmatched/page.tsx](src/app/admin/attractions/unmatched/page.tsx))

여기서 가능한 작업:
- **별칭 연결**: 미매칭 항목이 기존 관광지의 다른 이름이면 aliases로 연결
- **DB 추가**: 신규 관광지면 `/admin/attractions`로 이동해서 등록
- **CSV 다운로드**: attractions 업로드용 포맷 (`name,short_desc,long_desc,country,region,badge_type,emoji`)
- **무시 처리**: 관광지 아닌 활동(식사/이동 등)은 ignored로 분류

### 단계 3: 관광지 상세 등록 (관리자 페이지)
**`/admin/attractions`** ([src/app/admin/attractions/page.tsx](src/app/admin/attractions/page.tsx))

기능:
- **CRUD**: 목록/등록/수정/삭제 (인라인 편집)
- **CSV 업로드**: 엑셀 작업 후 일괄 upsert (멀티라인 지원, 500건 배치)
- **CSV 다운로드**: 필터된 목록 export
- **Pexels 수동 선택**: 관광지별로 사진 검색 → 수동 고르기
- **Pexels 일괄 자동**: 사진 없는 관광지 전체에 자동 수집 (최대 3장, 400ms 간격)

### 단계 4: AI로 설명 생성하는 경우 (사용자 주도)
기능 부재. 사장님이 외부 Claude에서 직접:
1. 관리자 페이지에서 CSV 다운로드
2. 외부 Claude에게 "각 관광지 short_desc/long_desc 작성" 요청
3. 엑셀 편집
4. 관리자 페이지에서 CSV 업로드

---

## 📚 API 레퍼런스 (기존)

### `/api/attractions` ([src/app/api/attractions/route.ts](src/app/api/attractions/route.ts))
| 메서드 | 기능 |
|--------|------|
| GET | 목록 조회 (필터: country/region/badge_type/search) |
| POST | 신규 등록 |
| PATCH | 수정 (id + 변경 필드) |
| PUT | CSV 일괄 upsert (name 기준) |
| DELETE | 삭제 (?id=...) |

### `/api/attractions/photos` ([src/app/api/attractions/photos/route.ts](src/app/api/attractions/photos/route.ts))
| 메서드 | 기능 |
|--------|------|
| POST | Pexels 검색 (keyword, per_page) |
| PATCH | 사진 저장 (id, photos[]) |

---

## 🧩 관련 유틸

- **매칭 엔진**: [src/lib/attraction-matcher.ts](src/lib/attraction-matcher.ts) — `matchAttraction`, `matchAttractions`
- **Pexels 클라이언트**: [src/lib/pexels.ts](src/lib/pexels.ts) — `searchPexelsPhotos`, `buildPexelsKeyword`

---

## 📋 배지 타입 (8가지)

| 값 | 용도 | 아이콘 |
|-----|------|-------|
| `tour` | 일반 관광 | 📍 |
| `special` | 특전 (포함 체험) | ⭐ |
| `shopping` | 쇼핑 | 🛍️ |
| `meal` | 특식 | 🍽️ |
| `optional` | 선택관광 | 💎 |
| `hotel` | 숙소 | 🏨 |
| `restaurant` | 식당 | 🥘 |
| `golf` | 골프 | ⛳ |

---

## ⚡ AI Agent가 관광지 관련 작업할 때 체크리스트

- [ ] 이 파일(`manage-attractions.md`)을 먼저 Read했는가?
- [ ] `db/seed_*_attractions.js` 같은 임시 스크립트를 만들려고 하는가? → **중단!** `/admin/attractions` 사용
- [ ] `/api/attractions`와 `/admin/attractions` 기존 기능을 확인했는가?
- [ ] 자동 short_desc 생성 코드를 쓰려 하는가? → **중단!** 사용자가 CSV 편집하도록 남김
- [ ] `register.md`의 "시드 필요 플래그" 의미를 이해했는가? (플래그만, 자동 생성 X)
