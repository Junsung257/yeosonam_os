---
description: Next.js 프론트엔드 — UX 원칙·서버/클라이언트 컴포넌트 구분·DOMPurify·SSR/ISR 성능.
paths:
  - "src/app/**/*.tsx"
  - "src/components/**/*.tsx"
  - "src/app/**/page.tsx"
  - "src/app/**/layout.tsx"
---

# 레시피: 프론트엔드

## 1. UX 원칙
- **인라인 에디트**: 리스트에서 셀 클릭 → 즉시 편집 (별도 수정 페이지 불필요)
- **연쇄 자동완성**: SKU 입력 → 랜드사·출발지 자동 채움
- **낙관적 업데이트**: 화면 먼저 → 백그라운드 API 호출 → 실패 시만 롤백 + 토스트

## 2. 서버 vs 클라이언트 컴포넌트
| 구분 | 판단 기준 | 라이브러리 사용 |
|---|---|---|
| 서버 컴포넌트 | `'use client'` 없음 | `isomorphic-dompurify`, Node.js API 가능 |
| 클라이언트 컴포넌트 | `'use client'` 있음 | `dompurify` (브라우저 전용만), `jsdom` 포함 패키지 사용 불가 |

## 3. HTML 렌더링 안전 패턴
`dangerouslySetInnerHTML` 사용 시 반드시 DOMPurify를 거칩니다:
```typescript
// 서버 컴포넌트
import DOMPurify from 'isomorphic-dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />

// 클라이언트 컴포넌트
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
```

마크다운이 포함될 수 있는 경우:
```typescript
import { marked } from 'marked';
const safeHtml = DOMPurify.sanitize(
  /<[a-z][\s\S]*>/i.test(rawText) ? rawText : marked.parse(rawText) as string
);
```

## 4. 고객 페이지 성능
고객이 보는 페이지에서 매 조회마다 API를 호출하는 useEffect는 서버사이드(SSR/ISR)로 옮길 것. 데이터 수집·분석 로직은 `page.tsx`(서버 컴포넌트)에서 ISR 빌드 시 1회만 실행.
