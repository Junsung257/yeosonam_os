# Threads 완전 자동화 실행 계획

## 상태: 구현 시작 (2026-05-26)

## 참고 출처

### 오픈소스 GitHub
- **SocialFlow** — 6-agent autonomous AI CMO (Scout→Planner→Creator→Reviewer→Publisher→Analyst)
- **OpenTwins** — 7-stage content pipeline, 10 platforms, Claude Code 기반
- **PostPilot** — Markdown-as-code CLI scheduler (참고만, Playwright 우회는 위험)
- **meta-threads-sdk** — Python Threads API wrapper (rate limit tracking 내장)
- **dmo-claw** — 관광청 DMO AI agent (n8n 기반, Instagram 자동 발행)
- **threads-bot** — 멀티계정 Playwright 자동화

### 학술 논문
- MDPI J. Theor. Appl. Electron. Commer. Res. (2026): ChatGPT-generated messages outperform human-generated in travel tourism social media engagement

### 여행사 사례
- insoftex (유럽 여행사): Multi-Agent System으로 하루 5→20포스트 달성. Tour Priority Score 기반 Planner

### Threads 데이터/전략
- 10K+ posts 분석: 40% opinion / 30% behind-scenes / 20% educational / 10% questions
- 1-3 posts/day, peak 7-9AM / 6-8PM
- Official API limit: 250 posts/24h, 1000 replies/24h

---

## 아키텍처 (3 Cron + 1 API)

```
[매일 07:00 KST]
Cron: threads-content-planner
  ├─ travel_packages → Priority Score 계산
  ├─ trend_learning → 현재 인기 스타일
  └─ → content_plans 테이블 (daily plan)

[매일 08:00 KST]
Cron: threads-content-generator
  ├─ content_plans → 각 포스트 AI 생성
  ├─ TrendStyle Engine → 문체 변환
  └─ → content_distributions (status: ready)

[15~30분마다]
Cron: threads-auto-publisher
  ├─ content_distributions (ready) 조회
  ├─ quota 체크
  ├─ publishToThreads 호출
  └─ → status: published / failed

[주 1회]
Cron: threads-performance-analyst
  ├─ 발행 성과 분석
  ├─ voice_samples 업데이트
  └─ StyleFingerprint 튜닝
```

## 콘텐츠 카테고리 (균형)

| 카테고리 | 비율 | 예시 |
|----------|------|------|
| **travel_tip** (여행꿀팁) | 40% | "보홀 처음 가면 이거 꼭 챙겨가세요" |
| **product_promo** (상품홍보) | 30% | "지금 예약하면 20% 할인" |
| **brand_story** (브랜드·비하인드) | 20% | "여소남 팀이 직접 다녀온 후기" |
| **engagement** (질문·참여유도) | 10% | "다음 여행지 골라주세요" |

## Priority Score 계산

```
score = (urgency_factor × 0.4) + (margin_factor × 0.3) + (scarcity_factor × 0.3)
- urgency: 출발 임박 (n일 이내) / 시즌 한정
- margin: 수익성 좋은 상품 우선
- scarcity: 남은 좌석 적은 순
```

## 안전장치

1. 하루 최대 5포스트 (quota 250의 2%)
2. 발행 간격 최소 1시간
3. quota 80% 이상이면 발행 중단
4. 연속 실패 3회 → 크론 일시 중단
5. engagement-bait 검증 (validateThreadsBody)
6. 동일 콘텐츠 중복 발행 방지 (payload hash 비교)
