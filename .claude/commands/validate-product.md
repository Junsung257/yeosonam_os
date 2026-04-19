# 상품 검증 (원문 ↔ A4 ↔ 모바일 3자 대조)

> **목적**: 등록된 상품의 원문/DB/렌더링 결과가 일치하는지 자동 검증.
> `/register` 이후 또는 기존 상품 회귀 검증에 사용.

사용자가 검증할 상품 정보:

$ARGUMENTS

---

## 🚨 Step 0: 필수 사전 참조

1. `db/error-registry.md` — 최근 10건 체크리스트
2. 이 커맨드는 **수정이 아니라 검증**. 발견된 이슈는 **보고만** 하고 사용자 승인 후 수정.

---

## Step 1: 대상 상품 식별

사용자 입력에서 아래 중 하나 추출:
- 상품 ID (UUID)
- 내부 코드 (예: `TP-KUL-06-01`)
- 상품명 (title 검색)

복수 상품 검증(예: 같은 원문에서 파생된 3박5일 + 4박6일 동시)도 지원.

## Step 2: DB 로드

```sql
SELECT id, title, duration, departure_days, destination, airline,
       min_participants, price_tiers, price_dates, price_list,
       inclusions, excludes, surcharges, optional_tours,
       itinerary_data, notices_parsed, special_notes, raw_text
  FROM travel_packages
 WHERE id = :id OR internal_code = :code;
```

## Step 3: 구조적 검증 (W1~W19 자동 실행)

`db/templates/insert-template.js`의 `validatePackage(pkg)` 를 호출하여 경고 수집:

| 경고 ID | 체크 내용 |
|---------|----------|
| W1~W12 | price_dates 형식, min_participants 범위, inclusions 형식 등 기본 데이터 무결성 |
| W13 | `min_participants` 원문 대조 (ERR-20260418-01) |
| W14 | `notices_parsed` 축약 감지 (ERR-20260418-02) |
| W15 | `surcharges` 기간 누락 (ERR-20260418-03) |
| **W16** | **`departure_days` JSON 배열 문자열 누출 (ERR-KUL-01)** |
| **W17** | **`optional_tours` 모호 이름에 region 누락 (ERR-KUL-04)** |
| **W18** | **DAY 교차 오염 의심 (ERR-KUL-02/03)** |
| **W19** | **`duration` ↔ `itinerary_data.days.length` 불일치** |

경고 1건 이상 시 상세 리포트 출력.

## Step 4: 원문 ↔ DB 필드 대조

`raw_text` 존재 시 수행:

1. **일차 수**: 원문 "제N일" 개수 vs `itinerary_data.days.length`
2. **가격 최저가**: 원문 ★취항특가★ / 최저가 표기 vs `price_dates` 최저가
3. **포함 특식**: 원문 "특식 N회" vs `inclusions` 내 특식 문자열 포함 여부
4. **쇼핑 횟수**: 원문 "쇼핑 N회" vs `special_notes`
5. **선택관광 개수**: 원문 `[X 선택관광]` 섹션 내 항목 vs `optional_tours.length`
6. **호텔 등급**: 원문 "(N성급)" vs `itinerary_data.days[].hotel.grade`

## Step 5: A4 ↔ 모바일 렌더링 일관성 대조 (선택)

환경 구동 가능 시 Playwright 등으로 렌더 비교:
- `A4 한 번` 렌더 → 포함된 관광지 명칭 집합 추출
- `모바일 한 번` 렌더 → 포함된 관광지 명칭 집합 추출
- 두 집합의 차집합이 존재하면 보고 (한 쪽에만 렌더된 항목)

구동 불가 시 스킵하고 "Manual 필요" 플래그만 기록.

## Step 6: 리포트 포맷

```markdown
# 검증 리포트: {title} ({internal_code})

## 🚨 Blockers (수정 필요)
- [W18] DAY 4 "메르데카 광장" — 원문에 없음. 다른 상품에서 복사된 교차 오염.
- [W16] departure_days가 `["금"]` JSON 문자열. 평문으로 변경 필요.

## ⚠️ Warnings
- [W14] notices_parsed 축약 의심 (원문 800자 vs 파싱 320자 = 40%)

## ✅ 통과
- W1~W12, W13, W15, W17, W19

## 📋 원문 대조
- 일차 수: ✅ 6일 (원문 "제6일"까지 존재)
- 최저가: ✅ ₩1,399,000 (원문 "★취항특가★ 6/19" 1,399,000 일치)
- 특식: ✅ "무제한 삼겹살" 포함
- ...

## 추천 조치
1. DB UPDATE: `itinerary_data.days[3].schedule` 에서 "메르데카 광장" 항목 제거
2. DB UPDATE: `departure_days = '금'` 으로 변경
```

## Step 7: 수정 진행 여부 확인

리포트 출력 후 사용자에게 질문:
> **"위 Blockers를 자동 수정할까요? (Y/N)"**

Y 승인 시:
- Blocker별 DB UPDATE SQL 생성 → dry-run 출력 → 승인 후 실행
- 수정 완료 후 Step 3~4 재실행 → 재검증 결과 보고

N 또는 무응답 시: 리포트만 저장하고 종료.

---

## 사용 예시

```
/validate-product TP-KUL-06-01
/validate-product 쿠알라룸푸르 4박6일
/validate-product 같은 원문의 3박5일+4박6일 두 상품
```
