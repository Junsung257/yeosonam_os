# travel_packages 필드 의미 사전 (Content Policy)

> **목적**: 각 필드에 어떤 내용이 들어가야 하는지 명시. ERR-FUK-customer-leaks 재발 방지.
> **원칙**: 구조(Zod)가 아닌 **의미(Semantic)** 검증 규칙.

---

## 🔒 고객 노출 필드 (Customer-Facing)

**절대 내부 운영 메모 넣지 말 것.** A4 포스터 / 모바일 랜딩에 그대로 노출됨.

| 필드 | 용도 | 허용 | 금지 |
|------|------|------|------|
| `title` | 상품명 | 마케팅 제목 | 내부 코드, "랜드사 ...", 해시태그 |
| `display_title` | 표시용 제목 (title 대체) | 클렌징된 제목 | 동일 |
| `product_summary` | 한줄 설명 (모바일 상단) | 고객 어필 문구 | 커미션, 정산 정보 |
| `product_highlights` | 핵심 특전 배지 | 상위 4개 어필 포인트 | "노팁/노옵션" 단독 |
| `inclusions` | 포함 사항 | 항목 배열 | 숫자 콤마 split 잔해 ("2\|000엔") |
| `excludes` | 불포함 사항 | 항목 배열 | surcharges와 중복, 숫자 split |
| `notices_parsed` | 유의사항 (4-type 구조화) | CRITICAL/PAYMENT/POLICY/INFO | 커미션 관련 |
| `itinerary_data.highlights.shopping` | 쇼핑 안내 | "노옵션 & 노쇼핑" / "3회" 등 | 내부 메모 |

**위반 감지**: `validatePackage` W21, W22, W23 경고

---

## 🔐 내부 필드 (Internal-Only)

고객에게 노출되지 않음. 운영/정산/검색용.

| 필드 | 용도 | 허용 |
|------|------|------|
| `land_operator_id` | 랜드사 UUID | 참조값만 |
| `commission_rate` | 커미션 % | number 0~100 |
| `short_code` | 내부 상품코드 | `<SUPPLIER>-<DEST>-<DAYS>-<NN>` |
| `internal_code` | ERP 연동 코드 | 자유 |
| `raw_text` | 원문 (감사용) | 전체 원문 |
| `filename` | 소스 파일명 | 자유 |
| `confidence` | AI 파싱 신뢰도 | 0~1 |

---

## ⚠️ 경계 필드 (Conditional)

**맥락에 따라 내부/외부 판단**. 주의 사용.

| 필드 | 원래 용도 | ⚠️ 주의 |
|------|---------|-------|
| `special_notes` | (과거) 자유 메모 | **A4 템플릿이 쇼핑 fallback으로 사용** — 커미션/내부 메모 절대 금지. null 권장. |

**special_notes 올바른 사용**:
- ✅ "쇼핑센터 3회 (차/실크/진주)"
- ✅ "룸타입은 개런티 불가"
- ❌ "랜드부산 10만원 커미션 고정" ← **고객 노출됨!**
- ❌ "commission_rate=0 저장 제약" ← **고객 노출됨!**

**커미션이 10만원 고정 같은 특수 케이스**:
- 1순위: `commission_rate = 0` + 정산 시 운영팀 별도 처리
- 2순위: 신규 DB 컬럼 `commission_fixed_amount` 추가 (향후)
- **절대 special_notes 사용 금지**

---

## 📋 필수 검증 규칙 (validatePackage)

| 코드 | 검사 | 심각도 |
|------|------|--------|
| W21 | special_notes에 내부 키워드 포함 | ❌ error (INSERT 차단) |
| W22 | 고객 필드에 내부 키워드 포함 | ❌ error |
| W23 | 숫자 split 잔해 (excludes/inclusions) | ❌ error |
| W24 | surcharges ↔ excludes 중복 | ⚠️ warning |
| W25 | flight activity 파싱 불가 포맷 | ⚠️ warning |

---

## 🗺️ A4 템플릿 Fallback Rules (주의)

A4 포스터 렌더 시 필드가 없으면 다음 순서로 fallback — **이 fallback 경로가 노출 위험의 근원**.

```
쇼핑센터 섹션:
  itinerary_data.highlights.shopping  ← 1순위
  ↓ (없으면)
  special_notes                        ← 2순위 (❗ 내부 메모 노출 원인)
```

**정책**: `itinerary_data.highlights.shopping` 을 **항상 명시적으로 설정**. null이어도 명시. special_notes에는 고객용 텍스트만.

---

## 📝 insert 스크립트 작성 시 체크리스트

- [ ] `special_notes` 에 "커미션", "정산", "LAND_OPERATOR", "commission_rate" 키워드 없는가?
- [ ] `itinerary_data.highlights.shopping` 명시했는가?
- [ ] `excludes` 항목 중 "2,000엔" 처럼 숫자 콤마 있는 항목 → `flattenItems`의 숫자 콤마 보호 테스트 통과했는가?
- [ ] `surcharges` 객체 배열이 있으면 `excludes` 문자열에 같은 정보 중복되지 않았는가?
- [ ] flight activity 가 "X 출발 → Y 도착 HH:MM" 또는 "X 출발 → Y HH:MM 도착" 포맷인가?
