# PPT 자동 생성 JSON 스키마

## 개요
여소남 OS에서 **고객 맞춤 여행 일정 PPT**를 자동으로 생성할 수 있습니다.
JSON 데이터만 제공하면 **pptxgenjs**가 고품질 PPT를 자동 생성합니다.

## 기본 요청 구조

```typescript
interface BriefingConfig {
  groupName: string;           // 그룹명 (예: "창원대 명품 30기")
  destination: string;         // 목적지 (예: "청도")
  departDate: string;          // 출발일 (YYYY-MM-DD)
  returnDate: string;          // 귀국일 (YYYY-MM-DD)
  duration: number;            // 박수 (정수)
  maxSlides?: number;          // 최대 슬라이드 수 (선택)
  colors?: {                   // 커스텀 색상 (선택)
    primary?: string;          // HEX 코드 (예: "0B1F3A")
    accent?: string;
    background?: string;
  };
  slides: BriefingSlide[];     // 슬라이드 배열
}

interface BriefingSlide {
  title: string;               // 슬라이드 제목
  subtitle?: string;           // 부제목 (제목 슬라이드용)
  layout: "title" | "two-col" | "timeline" | "grid" | "standard";
  imageKeyword?: string;       // 이미지 키워드 (아래 라이브러리 참조)
  content: {
    title: string;             // 섹션 제목
    description: string;       // 설명 텍스트
    details?: string[];        // 상세 항목 (선택)
    imageUrl?: string;         // 커스텀 이미지 URL (선택)
  }[];
}
```

---

## 이미지 키워드 라이브러리

`imageKeyword`에 사용할 수 있는 사전 정의된 고품질 무료 이미지:

### 항공
- `flight` - 비행기 객실
- `airplane` - 비행기 전경
- `airport` - 공항 라운지

### 숙박
- `hotel` - 호텔 로비
- `hotel-room` - 호텔 객실
- `luxury` - 럭셔리 인테리어
- `sheraton` - 프리미엄 호텔

### 음식 & 야시장
- `beer` - 맥주 및 양조장
- `brewery` - 양조 시설
- `night-market` - 야시장 및 야식
- `market` - 재래시장
- `street` - 거리 풍경
- `food` - 음식 및 요리

### 골프
- `golf` - 골프 코스
- `golf-course` - 골프장 전경
- `course` - 골프 코스 디테일

### 웰니스
- `spa` - 스파 및 마사지
- `massage` - 마사지 치료
- `wellness` - 웰니스 시설

### 도시 & 야경
- `city` - 도시 전경
- `night-city` - 야경 도시
- `skyline` - 스카이라인
- `night-view` - 야경 전망

### 테마파크 & 야경
- `theme-park` - 테마파크
- `light-show` - 빛의 축제

### 기타
- `ocean` - 해양 풍경
- `beach` - 해변
- `landscape` - 자연 경관
- `travel` - 여행 테마

**커스텀 이미지:** 위 키워드에 없으면 **Unsplash 이미지 직접 URL** 사용 가능

---

## 레이아웃 타입

### 1. `title` - 제목 슬라이드
```json
{
  "title": "부산 — 청도 3박4일",
  "subtitle": "36홀 골프투어",
  "layout": "title",
  "content": []
}
```
**렌더링:** 네이비 배경 + 대형 텍스트 + 메타 정보

### 2. `two-col` - 이미지 + 텍스트 2열
```json
{
  "title": "칭다오 맥주박물관",
  "layout": "two-col",
  "imageKeyword": "brewery",
  "content": [
    {
      "title": "100년 독일 양조장",
      "description": "1903년 독일 상인들이 세운 청도 맥주공장의 100주년 기념관..."
    }
  ]
}
```
**렌더링:** 좌측 이미지, 우측 텍스트 및 상세 정보

### 3. `standard` - 텍스트 중심 (기본)
```json
{
  "title": "포함 사항",
  "layout": "standard",
  "content": [
    {
      "title": "항공료",
      "description": "왕복 항공료 BX321/322",
      "details": ["유류할증료 포함", "TAX 포함"]
    }
  ]
}
```
**렌더링:** 헤더 + 콘텐츠 섹션 (bullet points 지원)

### 4. `timeline` - 시간순 일정
```json
{
  "title": "DAY 01 - 청도 입성",
  "layout": "timeline",
  "content": [
    {
      "title": "10:30 - 김해 출발",
      "description": "BX321 탑승"
    },
    {
      "title": "14:00 - 맥주박물관",
      "description": "도착 후 즉시 관광"
    }
  ]
}
```

### 5. `grid` - 4열 또는 6열 카드
```json
{
  "title": "여행 요약",
  "layout": "grid",
  "content": [
    {
      "title": "기간",
      "description": "3박 4일"
    },
    {
      "title": "라운딩",
      "description": "36홀"
    }
  ]
}
```

---

## 실제 예시: 청도 골프투어

```json
{
  "groupName": "창원대 명품 30기",
  "destination": "청도",
  "departDate": "2026-06-11",
  "returnDate": "2026-06-14",
  "duration": 3,
  "colors": {
    "primary": "0B1F3A",
    "accent": "C9A14A"
  },
  "slides": [
    {
      "title": "부산 — 청도 3박4일",
      "subtitle": "36홀 골프투어",
      "layout": "title",
      "content": []
    },
    {
      "title": "칭다오 맥주박물관",
      "layout": "two-col",
      "imageKeyword": "brewery",
      "content": [
        {
          "title": "100년 독일 양조장",
          "description": "1903년 독일 상인들이 세운 청도 맥주공장의 100주년 기념관으로, 시음 코너와 전시장을 갖추고 있습니다.",
          "details": ["갓 뽑은 청도 맥주 무료 시음", "독일식 설비 원형 보존", "관광 소요 약 90분"]
        }
      ]
    },
    {
      "title": "화산 CC · 18홀 라운딩",
      "layout": "two-col",
      "imageKeyword": "golf",
      "content": [
        {
          "title": "청도 명문 컨트리클럽",
          "description": "36홀 규모의 청도 화산 국제 골프장. 평탄한 구릉지 코스로 누구나 부담 없이 라운딩할 수 있습니다.",
          "details": [
            "Classic Course: Par 72, 6,540m",
            "Master Course: Par 72, 5,372m",
            "2인 1카트 · 2인 1캐디"
          ]
        }
      ]
    },
    {
      "title": "포함 사항",
      "layout": "standard",
      "content": [
        {
          "title": "항공 · 숙박 · 교통",
          "description": "왕복 항공료 (BX321/322) + 준5성급 호텔 3박 + 전용 33인승 차량",
          "details": [
            "유류할증료 + TAX 포함",
            "Four Points Sheraton Qingdao",
            "호텔 조식 3회 포함"
          ]
        },
        {
          "title": "골프 · 가이드 · 보험",
          "description": "36홀 그린피 + 캐디비 + 전용 한국어 가이드 + 여행자보험",
          "details": [
            "화산 CC · 영해 CC 라운딩",
            "2인 1카트 · 2인 1캐디",
            "미팅&샌딩 포함"
          ]
        }
      ]
    },
    {
      "title": "감사합니다",
      "subtitle": "즐거운 여행 되시길 바랍니다",
      "layout": "title",
      "content": []
    }
  ]
}
```

---

## API 호출 예시 (JavaScript)

```javascript
// 1. 데이터 준비
const briefingData = {
  groupName: "창원대 명품 30기",
  destination: "청도",
  departDate: "2026-06-11",
  returnDate: "2026-06-14",
  duration: 3,
  slides: [
    // ... 위의 슬라이드 배열
  ]
};

// 2. API 호출
const response = await fetch('/api/briefings/generate-ppt', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(briefingData)
});

// 3. PPT 다운로드
const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `${briefingData.groupName}-${briefingData.destination}.pptx`;
a.click();
URL.revokeObjectURL(url);
```

---

## 색상 기본값

```
primary: #0B1F3A (해군색)
accent: #C9A14A (금색)
background: #FFFFFF (흰색)
```

---

## 라이선스 & 속성

- **pptxgenjs** - MIT License
- **이미지** - Unsplash (완전 무료, 저작권 표시 불필요)

---

## 문제 해결

| 문제 | 해결 |
|------|------|
| 이미지 로드 실패 | 색상 블록으로 자동 폴백 |
| 텍스트 길이 초과 | 자동으로 폰트 크기 감소 |
| 폰트 오류 | 나눔고딕으로 자동 교체 |
| 파일 크기 너무 큼 | 이미지 압축 자동 적용 |

---

## 다음 단계

1. **Client UI 추가** → 웹 폼에서 JSON 입력 가능하게 개선
2. **템플릿 라이브러리** → 업종별 사전 정의 템플릿 제공
3. **배치 생성** → 여러 고객 한번에 생성
4. **Google Drive 자동 저장** → 생성 후 자동으로 클라우드 저장
