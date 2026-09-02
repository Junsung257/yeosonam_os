# 여소남 미디어 생성 현재 SSOT

> 상태: current · 검증일 2026-09-02. 이 문서는 미디어 권한·생성·검수 계약의 SSOT다. 워커 수, 큐 길이, canary 상태처럼 바뀌는 운영 값은 이 문서에 고정하지 않고 `npm run audit:media-generation`과 운영 화면에서 확인한다.

## 1. 결론

여소남 미디어 자동화는 OpenAI Images API와 `OPENAI_API_KEY`를 사용하지 않는다. 발행 서버는 안전한 코드형 이미지를 먼저 공개하고 `media_assets`에 작업을 쌓는다. 로그인된 Codex 로컬 자동화가 ChatGPT 구독에 포함된 built-in ImageGen으로 한 장씩 생성하며, 서버가 결과를 검수·정규화·영구 저장한 뒤 공개 커버를 원자적으로 교체한다.

외부 `gpt-image-skill`은 설치하지 않는다. 저장소 안의 `.agents/skills/blog-media-worker/SKILL.md`가 작업 수령·생성·업로드·검증 경계를 정의하고, 공용 `$imagegen` 스킬은 built-in mode로만 호출한다.

| 자산 종류 | 허용 소스 | 자동 생성 |
|---|---|---|
| 호텔·객실·항공·식사·관광지·상품 갤러리처럼 사실 증거가 필요한 이미지 | 공급사, 공식 출처, 기존 검증 사진 | 금지 |
| 블로그 커버 | 코드형 즉시 fallback → 구독형 콘셉트 이미지 비동기 교체 | 허용 |
| 홈 캠페인 Hero·정보형 카드뉴스 배경·SNS/OG | 검수 대기 구독형 콘셉트 이미지 | 허용 |
| 블로그 요약·CTA·비교 카드 | 코드 렌더링한 결정론적 그래픽 | 허용 |

AI 이미지는 `AI 생성 참고 이미지 · 실제 현장 기록이나 최신 운영 상황의 증거가 아닙니다.`를 공개면에 표시한다. 상품 `images_public`에는 `openai_generated`, `code_rendered` 자산을 넣지 않는다. 원장의 `source_kind='openai_generated'`는 기존 생성형 자산 분류를 호환하기 위한 값이며, 실제 실행·과금 경계는 `provider='codex_builtin'`과 `source_metadata.billing_surface='chatgpt_subscription'`으로 판별한다.

## 2. 구현 경계

- 큐 진입점: `src/lib/media-generation/index.ts`
- 정책·rollout: `src/lib/media-generation/policy.ts`
- 원장·claim·lease·일일 한도: `src/lib/media-generation/persistence.ts`
- 결과 검수·저장·블로그 교체: `src/lib/media-generation/worker.ts`
- 전용 인증: `src/lib/media-generation/worker-auth.ts`
- 내부 API: `/api/internal/media/codex/jobs/*`
- 로컬 브리지: `scripts/codex-media-job.mjs`
- Codex 작업 스킬: `.agents/skills/blog-media-worker/SKILL.md`
- 코드형 카드: `src/lib/media-generation/deterministic.ts`
- 프롬프트: `src/lib/media-generation/prompts.ts`
- 운영 화면: `/admin/marketing/media`

브라우저와 Codex 로컬 워커는 Supabase 쓰기 권한을 받지 않는다. 워커는 32자 이상의 전용 Bearer secret으로 내부 API만 호출한다. 서버는 업로드를 WebP 1536×864, OG 1200×630, 정사각 1080×1080, 세로형 1080×1350으로 정규화한다. 파일명은 content hash이며 같은 brief·prompt version은 idempotency key로 중복 생성을 막는다.

## 3. 자산 생명주기

`pending → generating → approved | pending_review | failed`, 승인된 원본의 대체 후보가 승인되면 원본은 `superseded`가 된다.

- 발행 요청은 이미지 생성 완료를 기다리지 않는다. 코드형 커버가 먼저 있어 빈 이미지·깨진 URL이 발생하지 않는다.
- Codex claim은 원장 row를 lease한다. 만료 lease는 회수하고 같은 작업은 총 2회까지만 시도한다. 생성 결과의 글자·로고·사람·특정 장소·왜곡을 Codex가 시각 검사하고 명시적 pass를 제출하지 않으면 서버가 업로드를 거부한다.
- KST 일일 claim 상한의 기본값은 6장이다. 이는 구독량을 보장하거나 구매하는 값이 아니라 여소남 측 과사용 방지선이다.
- 자동 블로그 커버만 QA 통과 즉시 붙는다. 홈 Hero, 수동 블로그 커버, 카드뉴스, SNS/OG는 `pending_review`로 남는다.
- 자동 교체는 여소남이 만든 fallback만 덮어쓴다. 공급사·공식·운영자가 고른 기존 이미지는 바꾸지 않는다.
- 원본당 재생성은 1회다. 새 후보가 승인되기 전까지 기존 승인 이미지를 유지한다.
- `media_assets`는 service-role 전용이고 공개 읽기는 immutable Storage URL만 사용한다.

## 4. 표면별 적용

- 블로그: 발행 직후 `content_creatives.id` 소유 작업을 큐에 넣는다. 구독형 생성 성공 시 공개 커버와 `generation_meta.media_cover`를 갱신하고 캐시·색인 outbox를 다시 처리한다. 인라인은 검증 본문 기반 코드형 요약·CTA 카드다.
- 홈페이지: `/admin/marketing/media`에서 승인된 `home_campaign_hero`만 캠페인 Hero로 노출한다. 기존 목적지 슬라이드는 검증된 사진을 유지한다.
- 여행상품 상세: 기존 `images_public`의 공급사·공식·검증 사진만 사용한다. 생성 이미지를 갤러리나 상품 사실 근거로 승격하지 않는다.
- 카드뉴스: 상품형은 공개 상품 snapshot 사진만 사용한다. 정보형은 구독형 master 배경을 큐에 넣되 승인 전에는 브랜드 placeholder를 사용한다.

Pexels 자동 fallback은 정상 경로에서 비활성이다. 장애 복구가 꼭 필요할 때도 `MEDIA_LEGACY_PEXELS_FALLBACK=true`와 호출 지점의 명시적 opt-in이 모두 있어야 한다.

## 4.1 OpenMontage 세로 영상 파일럿

OpenMontage는 공개·발행 경로가 아니라 내부 draft 도구 sandbox 후보다. 공식 `calesthio/OpenMontage`의 서명 검증 commit `cd9f3c1f03368be87b140af494914b8ee4e3c7a4`만 Docker build 때 clone하며 vendoring, upstream 수정, Skill 설치, 네트워크 서비스화를 하지 않는다. upstream 라이선스는 AGPL-3.0-only다.

- 입력은 승인된 정보성 블로그 revision, 본문 hash, 근거 hash, claim ledger만 허용한다. 웹 조사는 source discovery일 뿐 새 사실이나 판매 주장의 근거가 아니다.
- 호텔·객실·식사·관광지·상품 장면은 `internal_product_registration.media_assets`의 supplier/operator/official 계열, 사용 가능한 권리 상태, content hash, asset ID를 모두 가진 자산만 허용한다. stock/public archive는 `information_broll`과 `참고 영상` 표시에만 쓴다. 생성 이미지는 claim이나 상품 증거에 연결할 수 없다.
- 결과는 20–40초, 9:16, 1080×1920, H.264/AAC, 한국어 자막으로 제한하고 MP4/SRT/thumbnail/manifest를 `/private/video-worker/` 아래 draft로만 둔다. 업로드, SNS 발행, DB 쓰기, 유료 Hero provider는 없다. VA 승인 전 상태는 `draft_pending_va`다.
- Docker wrapper는 no-network, read-only root, read-only input, private writable output, non-root, no ports를 기본으로 한다. 공식 upstream에는 현재 Docker runtime이 없으므로 이 wrapper는 upstream 지원을 가장하지 않는 build-pending prototype이다.
- Piper 엔진 자체와 음성 모델의 라이선스는 별도로 본다. 확인된 `ko_KR-kss-medium` 모델은 dataset license가 CC-BY-NC-SA-4.0이므로 상업 영상에 `license_blocked`다. 상업 사용이 명시 승인된 한국어 voice hash가 등록되기 전에는 실제 한국어 렌더를 시작하지 않는다.

권위 계약은 `config/openmontage-worker.json`과 `src/lib/video-worker/contracts.ts`다. 세 개의 합성 정보성 fixture와 상품 호텔 장면을 stock으로 바꾸려는 음성 사례는 정책 단위 테스트일 뿐 실제 승인 블로그 3건의 렌더 증거가 아니다. Docker build/preflight, 승인 블로그 3건, 잘못된 대체영상 1건, ffprobe/자막/음량/watermark QA와 실제 시간 개선이 모두 확인되기 전에는 후속 DB 작업 원장이나 발행 파이프라인을 설계하지 않는다.

## 5. 운영 설정과 실행

정확한 변수는 `docs/env-variables-reference.md`가 SSOT다.

1. `20260828063117_media_assets_v1.sql`, `20260828090056_media_codex_worker_v1.sql`, `20260828103551_media_assets_rls_and_fk_hardening.sql`을 순서대로 적용한다. 마지막 마이그레이션은 선행 버전이 이미 적용된 환경에 명시적 service-role 정책과 self-FK 인덱스를 전진 보강한다.
2. Vercel 서버와 Windows 사용자 환경에 같은 `MEDIA_CODEX_WORKER_TOKEN`을 설정한다. 토큰은 채팅·파일·로그에 출력하지 않는다.
3. Vercel에 `MEDIA_CODEX_ENABLED=true`, 낮은 blog rollout, 일일 상한을 설정한다.
4. 로컬 Codex 예약 작업이 `$blog-media-worker`를 호출해 회당 한 작업만 처리하도록 한다. Codex 앱이 로그인돼 있고 해당 PC가 실행 가능한 상태여야 한다.
5. `/admin/marketing/media`와 공개 블로그에서 provenance, QA, disclosure, immutable URL, 실제 커버 교체를 확인한 뒤 rollout을 높인다.

권장 예약 시각은 KST 09:15, 12:15, 15:15, 18:15, 21:15와 보충 22:00이다. 예약이 실패하거나 PC가 꺼져 있어도 발행물은 코드형 fallback으로 정상 공개되고, 대기 작업은 다음 실행에서 처리된다.

## 6. 운영 게이트

- [x] 세 migration과 Storage bucket 운영 적용
- [x] Vercel/Windows 전용 토큰 동일 설정과 토큰 비노출
- [x] `OPENAI_API_KEY` 없이 claim → built-in 생성 → complete → verify 실제 `social_og` canary
- [x] live 원장·공개 URL 감사 14개 통과
- [x] clean release PR #1165를 `main`에 병합하고 Vercel Production에 배포
- [x] `MEDIA_CODEX_ENABLED=true` 재배포와 정규·보충 예약 작업 활성화
- [ ] 다음 자연 발행 블로그에서 자동 커버 부착 canary 한 건 확인
- 공개 alt/caption 고지와 상품 실사 경계 확인
- 자동 블로그 교체가 관리 fallback만 덮어쓰는지 확인
- 재시도 2회, lease 만료 회수, 일일 상한, 빈 큐 동작 확인
- 운영 중 구독 allowance 부족 시 fallback 유지와 오류 원장 확인
