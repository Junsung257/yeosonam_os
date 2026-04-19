# 🗺️ 관광지(Attractions) 관리 가이드

> **⚠️ [필독] 이 파일은 관광지 관련 작업의 유일한 진입점입니다.**
> 관광지 DB를 건드리기 전 반드시 이 파일을 먼저 Read하세요.
> 여소남 OS는 **이미 관광지 관리 완전 파이프라인**을 갖추고 있습니다. 새로 만들지 마세요.

---

## 🚨 절대 금지 사항 (ERR-20260418-33 재발 방지)

### ❌ 하지 말 것

1. **상품 등록(/register) 시 관광지 자동 시드 금지**
   - `register.md` 지시: "없으면 **시드 필요 플래그**" (플래그만, 자동 생성 X)
   - 자동 시드하면 AI 환각 → 오매칭 → 고객 혼란

2. **`db/seed_XXX_attractions.js` 같은 지역별 임시 스크립트 생성 금지**
   - 이미 통합 파이프라인이 있음 (`/admin/attractions/unmatched`)
   - 임시 스크립트는 관리 부재 → 품질 악화

3. **AI(Sonnet/Gemini)로 short_desc/long_desc 자동 생성 후 바로 DB INSERT 금지**
   - 환각·오류·중복 유발
   - 반드시 사용자 검토 거쳐야 함

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
