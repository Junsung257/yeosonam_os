# Solapi 리뷰 요청 알림톡 템플릿 등록 가이드

> 여행 종료 후 D+1 자동 발송되는 리뷰 요청 알림톡을 Solapi 에 등록해야 실제로 고객에게 발송됩니다.
>
> 현재 코드는 이미 완성되어 있고(`src/lib/kakao.ts` · `sendReviewRequestAlimtalk`),
> `KAKAO_TEMPLATE_REVIEW_REQUEST` 환경변수에 템플릿 ID 만 넣으면 즉시 작동합니다.

---

## 1. 템플릿 등록 절차 (Solapi Admin)

1. [Solapi 콘솔](https://console.solapi.com) 로그인
2. **알림톡 → 템플릿 관리 → 새 템플릿 등록**
3. **카테고리**: `여행/관광`
4. **템플릿 이름**: `여소남_리뷰_요청_D1`

## 2. 템플릿 본문 (복사-붙여넣기)

```
#{고객명}님, 여소남입니다.

#{상품명} 여행 어떠셨나요?

다른 여행자분들께 큰 도움이 되는 소중한 후기를 남겨주세요.
응답자 중 추첨으로 스타벅스 쿠폰을 드립니다.

▶ 후기 작성: #{조사링크}
▶ 친구 공유: #{공유링크}

감사합니다.
여소남 드림
```

## 3. 변수 매핑

| Solapi 변수 | 코드에서 주입 | 예시 |
|---|---|---|
| `#{고객명}` | `params.name` | "김OO" |
| `#{상품명}` | `params.productTitle` | "부산출발 다낭 3박5일 가성비 패키지" |
| `#{조사링크}` | `${BASE_URL}/review/${booking_id}` | `https://yeosonam.com/review/abc-123` |
| `#{공유링크}` | `${BASE_URL}/share/new?booking=...` | `https://yeosonam.com/share/new?booking=abc-123` |

## 4. 버튼 등록 (선택)

**"후기 작성하기"** 버튼을 본문 하단에 추가:
- **버튼 타입**: `웹링크`
- **버튼 이름**: `후기 작성하기`
- **URL**: `#{조사링크}` (변수 연결)

## 5. 환경변수 등록

Vercel 프로젝트 환경변수에 추가:
```
KAKAO_TEMPLATE_REVIEW_REQUEST=<Solapi에서 받은 템플릿 ID>
```

## 6. 동작 확인

1. 어드민에서 예약을 생성 (status=completed + end_date=어제)
2. `curl https://yeosonam.com/api/cron/post-travel` 호출
3. 해당 고객 카톡에 알림톡 수신 확인
4. 링크 클릭 → `/review/[booking_id]` 폼 진입 확인

## 7. 검수 기준

Solapi 는 승인에 평균 1~2일 소요됩니다. 거절 사유 자주 발생하는 것:
- **광고성 문구** 포함 (❌ "특가") → 정보성 문구로 수정
- **변수 오타** (`#{고객}` 대신 `#{고객명}`)
- **링크 허용 도메인 미등록** → Solapi에 `yeosonam.com` 등록 필요

## 8. 관련 코드 위치

- 발송 함수: [src/lib/kakao.ts:235](../src/lib/kakao.ts) (`sendReviewRequestAlimtalk`)
- 크론: [src/app/api/cron/post-travel/route.ts](../src/app/api/cron/post-travel/route.ts)
- 수집 폼: [src/app/review/[booking_id]/page.tsx](../src/app/review/[booking_id]/page.tsx)
- API: [src/app/api/reviews/route.ts](../src/app/api/reviews/route.ts)

## 9. 예상 효과

- **리뷰 수집률**: 현재 0% → 업계 평균 15~25% (알림톡 발송 시)
- **SEO 효과**: Schema.org `aggregateRating` 리치스니펫 노출 → Google 검색 CTR +30%
- **신규 예약 영향**: 별점 4.5+ 표시 페이지는 전환율 +40% 검증됨
