# Affiliate V2 Rollout / Rollback

## 순서

1. 스테이징에 migration을 적용하고 schema drift/권한/trigger 검증 SQL을 실행한다.
2. 커미션 정책을 승인·활성화한다. 정책이 없으면 settlement 생성 실패가 정상이다.
3. `partner_session`과 초대/OTP를 활성화하고, 운영에서 파트너별 자격증명을 회전한다.
4. `/partner`를 제한 파일럿에 열고 실제 DNS·테스트 클릭·게시 URL을 확인한다.
5. 원장/정산 PDF/지급 증빙을 수동 대사한 후 확대한다.
6. 지급·세금 프로필은 스테이징에서 암호화 저장, 마스킹 응답, 관리자 검토 전이와 재제출을 확인한다.

## 즉시 롤백 가능한 조치

- `/partner` 기능 플래그를 닫고 레거시 읽기 화면으로 안내한다.
- 정산 생성·지급 요청 기능 플래그를 닫는다. 기존 V2 rows는 삭제하지 않는다.
- 게시 생성은 잠그되 기존 짧은 URL은 고객 이동만 허용하고 신규 귀속은 정책에 따라 차단한다.
- 도메인 검증 실패 시 해당 publication만 PUBLISHED 전환을 막는다.
- 지급·세금 검토 장애 시 제출 API만 잠그고 `affiliate_payout_profiles`·`affiliate_tax_profiles`와 검토 이력을 보존한다. 이미 `VERIFIED`인 계정의 지급을 임의로 되돌리지 않는다.

## 금지된 롤백

- `settlement_runs`, `settlement_lines`, `payouts`, 지급 증빙을 삭제하거나 원래 금액으로 덮어쓰기
- 완료 정산 VOID
- 운영 파트너의 PIN을 일괄 삭제하기 전에 초대/OTP 회전 확인
- 검증되지 않은 레거시 settlements 자동 이관
- 암호화 프로필 payload를 평문으로 복호화해 백필하거나, 프로필 테이블을 DROP하는 롤백

정정은 항상 감사 actor·사유·원본 ID를 가진 새 reversal/revision으로 남긴다.
