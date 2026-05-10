---
description: Next.js App Router API 라우트 표준 템플릿·공개 경로(PUBLIC_PATHS)·웹훅 멱등성 규칙.
paths:
  - "src/app/api/**/*.ts"
  - "src/middleware.ts"
---

# 레시피: API 라우트

## 1. 표준 API 라우트 템플릿
모든 API 라우트는 이 뼈대를 따릅니다:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  try {
    const { searchParams } = request.nextUrl;
    // ... 파라미터 파싱 + 쿼리 실행
    const { data, error } = await supabaseAdmin.from('table').select('*');
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
```

## 2. 공개 경로 관리
인증 불필요한 경로는 `middleware.ts`의 `PUBLIC_PATHS`에 추가. **새 공개 API를 만들 때 첫 번째로 할 일.**

현재 공개 경로:
- 화면: `/`, `/packages`, `/blog`, `/concierge`, `/group-inquiry`, `/rfq`, `/tenant`, `/share`, `/influencer`, `/with`, `/legal`
- API: `/api/cron/*`, `/api/slack-webhook`, `/api/notify/*`, `/api/tracking`, `/api/blog`, `/api/sms/receive`, `/api/qa/chat`

## 3. 멱등성
웹훅·크론은 동일 요청이 여러 번 와도 안전해야 합니다. `ON CONFLICT DO NOTHING` 활용.
