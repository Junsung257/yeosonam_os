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

## 🆕 2026-04-27 — `special_notes` deprecation + customer/internal 분리

| 필드 | 노출 | 용도 |
|------|------|------|
| `customer_notes` | 🟢 고객 OK | 고객 노출 자유 텍스트. CRC `resolveShopping` fallback 출처. W21 키워드 검증. |
| `internal_notes` | 🔒 운영 전용 | 커미션·정산·랜드사 협의·운영 메모. 어떤 텍스트도 OK. 어드민에서만 표시. |
| `special_notes` | ⚠️ DEPRECATED | LLM 컨텍스트(card-news, content-brief 등)·어드민 호환용. **고객 fallback 경로 모두 제거됨.** 신규 등록은 customer/internal 사용. |

**커미션이 10만원 고정 같은 특수 케이스** (P1 #5, 2026-04-27 적용):
- ✅ `commission_fixed_amount` (정액 KRW/USD/JPY/CNY) + `commission_currency` 사용
- 정액 모드일 때 `commission_rate = 0` 자동 설정 (상호배타)
- `internal_notes` 에는 운영 메모만 — 정액 정보는 컬럼에 명시
- ❌ `customer_notes` 에 마진 정보 절대 금지 (W21 차단)

**랜드부산 정액 마진 적용 사례**:
- LB-FUK-03-01/02 → 100,000원/건 정액
- LB-TAO-03-01, 04-01 → 90,000원/건 정액

**createInserter 사용**:
```js
const inserter = createInserter({
  landOperator: '랜드부산',
  commissionFixedAmount: 90000,  // 정액 (commissionRate 무시됨)
  commissionCurrency: 'KRW',
  ticketingDeadline: '2026-04-29',
  destCode: 'TAO',
});
// 또는 % 마진:
const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,             // %
  ticketingDeadline: '2026-04-15',
  destCode: 'NHA',
});
```

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
