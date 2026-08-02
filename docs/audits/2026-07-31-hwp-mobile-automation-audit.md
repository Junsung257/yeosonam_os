# HWP → 상품등록 → 모바일랜딩 자동화 감사

감사 시각: 2026-08-01 KST (최종 빌드 재검증 포함)

## 결론

- 원본 HWP 39개에서 분리한 상품은 71개이며 TXT 재읽기 SHA-256이 71/71 일치한다.
- 현재 코드·운영 관광지·승인 목적지 이미지를 사용한 재감사에서 오프라인 공개 가능 71/71, 고객 콘텐츠 준비 68/71(95.8%), 고객 이미지 준비 71/71이다.
- 준비되지 않은 3개는 원문에 최소 출발 인원 조건이 있으나 숫자가 없어 공급사 회신이 필요하다. 기본값이나 추정값으로 보완하지 않는다.
- 실제 등록 준비는 0/71이다. 71개 모두 실제 랜드사·계약 커미션 근거가 없고 `product_commercial_contracts` 원장도 0건이므로 저장/공개 게이트가 정상적으로 차단한다.
- 따라서 현재 상태는 “고객 콘텐츠 목표 95% 달성, 계약 사실 입력 전 운영 공개 0건”이다.

## 이번 반영

- 공식 근거 관광지 마스터 36건과 연길민속촌 정부 근거를 운영 DB에 반영했다.
- 해양박물관에 잘못 연결된 타지역·일반 별칭을 제거했다.
- 근거 승인 공급사 문구는 전역에서 유일한 exact match일 때만 다지역 상품의 첫 도시 scope를 넘어 매칭한다.
- Wikimedia Commons 목적지 이미지 13건은 저장 이미지 바이너리, 목적지 식별, 원본 파일 페이지, 라이선스, 저작자를 모두 확인해 `automated_evidence_gate`로 승인했다.
- `/packages`와 `/lp`에서 현재 승인 히어로와 정확히 일치할 때 저작자·공급자·라이선스 링크를 표시한다.
- 비공개 계약 원장과 `/admin/commercial-contracts`를 추가했다. 근거·유효기간·명시 marker가 있는 계약만 자동 적용하며 충돌은 보류한다.
- 목적지 이미지 승인 cron과 업로드 후 공개 오토파일럿 cron을 `vercel.json`에 매일 실행하도록 연결했다.
- 전체 Vitest, 전체 ESLint, TypeScript 타입 검사, 상품등록 계약 검사, Next 프로덕션 빌드(385개 페이지 및 `.next` 산출물 검증)를 통과했다.
- Next 빌드 타입검사 힙 부족을 재현한 뒤 빌드 래퍼 기본 힙을 6GB에서 7GB로 상향해 배포 환경의 동일 OOM 재발 가능성을 낮췄다.

## 증빙 위치

- 원본/상품 감사: `scratch/upload-inbox-batch-reports/2026-07-28T23-28-40-714Z/offline-source-audit.json`
- 71개 개별 입력: `scratch/upload-inbox-batch-reports/2026-07-28T23-28-40-714Z/upload-one-by-one-inputs/`
- 관광지 근거 묶음: `scratch/upload-inbox-batch-reports/2026-07-28T23-28-40-714Z/attraction-owner-review-pack.json`
- 관광지 검토 dossier: `scratch/upload-inbox-batch-reports/2026-07-28T23-28-40-714Z/attraction-review-dossier.md`

## 남은 외부 입력

1. 실제 계약서/합의서 기준 랜드사와 커미션을 `/admin/commercial-contracts`에 등록한다. 상품마다 반복 입력하지 않는다.
2. 최소 출발 인원이 비어 있는 3개 상품은 공급사에서 성인 기준 숫자를 회신받아 원문 또는 명시 override에 기록한다.
3. 그 뒤 71개 TXT를 한 건씩 업로드하면 기존 queue와 `/api/cron/upload-to-open-autopilot`이 엔티티 정리, `/packages`·`/lp` 모바일 proof, 최종 감사, 조건부 공개까지 수행한다.

앱 코드와 cron 설정은 현재 작업 트리에 있으며, 아직 Git 커밋·Vercel 프로덕션 배포는 수행하지 않았다. 배포 전까지 고객 공개 0건 상태가 의도된 안전 상태다.

## 보안 확인

- `product_commercial_contracts`는 RLS 활성화, anon/authenticated 권한 없음, service-role 전용 정책을 확인했다.
- Supabase security advisor에 이번 신규 테이블 관련 경고는 없었다. 기존 프로젝트 전역 INFO/WARN은 이 감사 범위 밖이며 별도 보안 백로그로 유지한다.
