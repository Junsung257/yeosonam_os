# Blog search performance import 런북

## 저장 모델

`blog_search_performance`에는 관측된 query-page 성과만 저장합니다: provider, metric date, query, page URL, clicks, impressions, CTR, average position, device, country, imported time, batch ID, row hash. GSC impression을 monthly search volume으로 바꾸거나 Naver DataLab ratio에 임의 배수를 곱하지 않습니다.

## Naver Search Advisor CSV

1. Search Advisor에서 날짜, 검색어, URL, 클릭수, 노출수, 클릭률(가능하면 평균순위 포함)을 CSV로 export합니다.
2. 원본 파일을 변경하지 않고 SHA-256 batch ID가 만들어지는지 dry-run합니다.

```powershell
npm run import:blog-search-performance -- --input=naver.csv --provider=naver_search_advisor
```

3. `docs/audits/blog-search-performance-import-preview.json`에서 row 수, 날짜 범위, 합계와 sample을 원본과 대조합니다.
4. schema migration 적용 후 승인된 change window에서만 아래를 실행합니다.

```powershell
$env:BLOG_SEARCH_IMPORT_APPLY_CONFIRM='OBSERVED_METRICS_REVIEWED'
npm run import:blog-search-performance -- --input=naver.csv --provider=naver_search_advisor --apply
```

row hash unique key로 같은 원본 재수입은 중복 저장되지 않습니다. clicks > impressions, CTR > 1, 잘못된 URL/날짜는 실패합니다.

## Google Search Console

GSC API에는 readonly scope만 부여합니다. API key가 없거나 결과가 0 rows이면 성공이 아니라 `empty_observed_metric_import` 또는 운영 readiness 오류입니다. GSC도 동일 importer CSV 경로를 사용할 수 있습니다.

```powershell
npm run import:blog-search-performance -- --input=gsc.csv --provider=google_search_console
```

query/page metric은 demand와 refresh opportunity에 사용합니다. position 4~20, 낮은 CTR, customer question frequency, active product relevance, seasonality, freshness를 가점으로 사용하고 cannibalization/template saturation을 감점합니다.

## 개인정보와 attribution

원시 상담 내용, DM 본문, 카카오톡 사용자 ID는 저장하지 않습니다. customer question은 집계 frequency와 승인된 source reference만 demand signal로 저장합니다. 방문자 query는 원문을 analytics event에 저장하지 않고 필요한 경우 one-way hash만 저장합니다.
