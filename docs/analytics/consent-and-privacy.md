# Consent Mode v2·개인정보 검토

## 구현 상태

- 정책: Basic Consent Mode. 기본값 네 신호 모두 `denied`.
- 신호: `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`.
- UI: 모두 허용, 필수만 허용, 선택 설정, 나중에 다시 열기.
- 저장: first-party localStorage와 최소 consent cookie, 180일.
- GTM: 분석 또는 광고 동의가 있기 전에는 로드하지 않는다.
- 동의 철회: attribution 전체 삭제 또는 광고 click ID 삭제.

## PII 방지

typed event API에 PII 필드가 없고 런타임 sanitizer가 이름·전화·이메일·주소·여권·생년월일·메시지·메모 키와 전화/이메일 형태 값을 차단한다. referrer는 host만, landing URL은 path만 저장한다.

다음은 analytics로 보내지 않는다: 고객 이름, 전화, 이메일, 상세 주소, 여권/주민번호, 생년월일, 건강정보, 자유 문의, 고객 메모, Kakao 사용자 식별정보.

## 운영자·법률 검토 필요

- 개인정보처리방침의 GA4, Google Ads, GTM, 선택적 Clarity 수탁/국외 이전 항목.
- 분석/광고 cookie 목적, 공급자, 보존 기간.
- 동의 철회 경로와 삭제 정책.
- Enhanced Conversions 도입 전 고객 데이터 약관과 별도 동의 근거.
- 한국 외 사용자에 대한 지역별 문구. 이번 코드에는 추측 기반 geolocation 분기가 없다.

이 문서는 기술 구현 기록이며 법률 자문이나 확정 법률 문구가 아니다.
