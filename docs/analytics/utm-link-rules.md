# UTM 링크 규칙

Admin에 새 화면을 추가하면 핵심 측정 범위를 불필요하게 넓히므로 이번 변경은 중앙 URL 유틸리티와 규칙까지만 제공한다.

네이버 블로그:

```text
utm_source=naver
utm_medium=blog
utm_campaign=<campaign>
utm_content=<article-or-cta-position>
```

네이버 검색광고:

```text
utm_source=naver
utm_medium=cpc
utm_campaign=<campaign>
utm_term=<keyword>
utm_content=<creative>
```

Google Ads는 자동 태그 추가를 사용하고 UTM을 병행할 경우 source/medium을 일관되게 유지한다. Instagram, Threads, Kakao도 `source`는 플랫폼, `medium`은 `social`, `paid_social`, `referral` 등 운영 정의를 고정한다.

`buildMarketingUrl()`은 UTM 5개만 추가하고 HTTP(S) 및 값 형식을 검증하며 자체 도메인 여부를 반환한다. URL 전체 query를 attribution 저장소에 복사하지 않는다.
