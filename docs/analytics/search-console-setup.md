# Search Console 설정

Search Console은 리타게팅 도구가 아니라 소유권·색인·검색 유입 분석 도구다.

1. Search Console property selector → Add property.
2. 권장: Domain property `yeosonam.com`을 DNS로 인증. 대안: URL-prefix `https://www.yeosonam.com/`.
3. meta 인증을 쓸 때 token만 `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`에 저장 후 배포하고 Verify.
4. Sitemaps → `https://www.yeosonam.com/sitemap.xml` 제출.
5. URL Inspection으로 대표 `/packages/[id]`, `/lp/[id]`, `/blog/[slug]`의 live test와 canonical을 확인.
6. GA4 Admin → Product links → Search Console Links에서 property와 web stream을 연결.

코드 정책:

- 공개 승인·publication gate를 통과한 상품만 `/packages/[id]`와 `/lp/[id]`로 sitemap에 들어간다.
- 두 경로는 각각 self-canonical이며 공개 데이터를 못 읽으면 noindex다.
- Admin, preview, 내부 API는 sitemap에서 제외하고 기존 gate/noindex를 유지한다.
- `robots.txt`는 API/Admin을 차단하고 sitemap 위치를 선언한다.
