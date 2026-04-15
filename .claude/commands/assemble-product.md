# 서안 어셈블러 상품 등록 프로세스

사용자가 원문 텍스트를 제공하면 어셈블러로 상품을 등록합니다.

$ARGUMENTS

---

## 프로세스 (순서 엄수)

### Step 1: 원문 → sample.txt 저장
사용자가 제공한 원문을 `db/sample.txt`에 저장한다.

### Step 2: dry-run 실행
```bash
node db/assembler_xian.js db/sample.txt --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --dry-run
```

### Step 3: 검수 리포트 확인
dry-run 결과에서 다음을 사용자에게 보여준다:
- ✅/⚠️ 항목 전체
- `itinerary_data.days` 일수
- `price_dates` 개수 + 첫/끝 날짜
- `inclusions` / `excludes` 배열 (원문 파싱 결과)
- `optional_tours` 목록
- `display_title`

### Step 4: 사용자 승인 후 --insert 실행
```bash
node db/assembler_xian.js db/sample.txt --operator <랜드사> --commission <N> --deadline <YYYY-MM-DD> --insert
```

### Step 5: 등록 후 검증
- package_id, short_code 확인
- 기존 동일 상품 있으면 먼저 archived 처리

### Step 6: 정리
```bash
rm db/sample.txt
```

---

## itinerary_data 스키마 규칙 (위반 시 포스터/랜딩 크래시)

### schedule[].type 허용값 (ScheduleItemType)
```
'normal' | 'optional' | 'shopping' | 'flight' | 'train' | 'meal' | 'hotel'
```
- ❌ `'transport'` 절대 사용 금지 → `isTransportSegment()` 오감지 → TransportBar 크래시
- 전용차량 이동은 `type: 'normal', transport: '전용차량'`으로 표현

### highlights.remarks는 string[] (구조화 객체 아님)
```javascript
// ✅ 올바름
remarks: ['• 여권 유효기간 6개월 이상', '• 일정 변경 가능']

// ❌ 크래시 유발
remarks: [{ type: 'CRITICAL', title: '필수', text: '...' }]
```
- `notices_parsed`는 구조화 객체 OK
- `highlights.remarks`는 반드시 string[]

### price_dates 필수
```javascript
price_dates: prices.map(p => ({ date: p.date, price: p.price, confirmed: false }))
```
- 빈 배열이면 달력형 요금표가 안 보임
- 어셈블러가 자동 생성하지만 반드시 확인

### 호텔 null 처리
- Day 1 (심야출발): `hotel: { name: null }` → A4에서 ✈️ 기내숙박
- 마지막 날 (귀국): `hotel: { name: null }` → A4에서 숨김
- 공항이동 후 출발: `hotel: { name: null }` → A4에서 🏢 공항대기

### 선택관광 vs 쇼핑 분리
- `type: 'optional'` → 선택관광 묶음 블록으로 렌더
- `type: 'shopping'` → 일정 타임라인에서 제거, 상단 별도 표시
- `optional_tours[]`에 쇼핑 항목 넣지 말 것

### 포함/불포함 원문 파싱
- 원문 "포함사항:" 줄 → 콤마 분리 → `inclusions[]`
- 원문 "불포함:" 줄 → 콤마 분리 → `excludes[]` (가이드경비 $50/인 등 그대로)
- 없으면 템플릿 기본값 fallback

---

## 품격 전용 블록 (실속에서 제외)
- `XAN-B013` (서안성벽 + 함광문유적지): `only_for: '품격'`
- 실속 상품에서 자동 필터링됨

## 랜드사 매핑
```
투어폰:     43a54eed-1390-4713-bb43-2624c87436a4 (TP)
랜드부산:   bca5ed71-ef0a-4fd4-b24e-c88c3d1e7d73 (LB)
```

## Destination 코드
```
XIY: 서안
```
