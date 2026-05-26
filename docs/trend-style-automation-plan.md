# 트렌드 기반 자동 문체 변환 시스템 — 도입 계획

> 조사일: 2026-05-26 | 출처: GitHub 오픈소스 5종 + SaaS 3종 + 논문 1종

---

## 1. 현재 상태 (Problem)

### 문제점
- **고정된 하나의 문체**: `BLOG_STYLE_GUIDE`라는 하나의 프롬프트로 모든 블로그가 동일한 톤으로 생성됨
- **트렌드 무시**: SERP 분석은 하지만 트렌드에 맞춰 문체/구조를 바꾸지 않음
- **AngleType 비연동**: 가성비/감성/럭셔리 등 AngleType은 카드뉴스에만 영향, 블로그 본문에는 미적용
- **채널 무감각**: 블로그/쓰레즈/인스타 각각에 최적화된 문체가 없음
- **피드백 루프 부재**: 어떤 문체가 더 좋은 성과를 내는지 측정/학습하지 않음

### 현재 파이프라인 (단순)
```
SERP 분석 → Topic 생성 → LLM 생성(generatePillar) → 품질 게이트 → 발행
                                  ↑
                          BLOG_STYLE_GUIDE (고정)
```

---

## 2. 목표 상태 (Solution)

```
SERP 분석 → Topic 생성 → Style Selector → LLM 생성 → Quality Gate + Style Check → 발행
                           ↑                          ↑
                    Trend Analyzer           Brand Voice Fingerprint
                    (Google Trends)          (JSON style profile)
```

---

## 3. 차용 가능한 오픈소스 프로젝트 (5종)

### 3.1 [stylometric-transfer](https://github.com/ngpepin/stylometric-transfer) ⭐ **추천**
**무엇**: 기존 글에서 스타일 지문(JSON fingerprint)을 추출 → 새 글을 그 스타일로 재작성

**가져올 핵심 개념**:
```
1. 기존 잘 팔리는 글 모음 → stylometric profiling (JSON fingerprint)
2. fingerprint = 문장 길이, 단락 구조, 구두점 패턴, 감정적 페이싱, 전문 용어 밀도
3. 새 글 생성 시 fingerprint 조건부 LLM 호출
4. deviation report로 스타일 일치도 점수화
```

**우리 적용법**:
- `brand-fingerprint.json` 파일 관리 (여소남의 브랜드 보이스를 JSON 프로파일로)
- 생성 이후 생성된 글의 fingerprint deviation 측정 (품질 게이트에 style 일치도 추가)
- 잘 팔린 글 → 분석 → fingerprint 업데이트 (피드백 루프)

---

### 3.2 [agent-style-transfer](https://github.com/ArcadeAI/agent-style-transfer) ⭐ **추천**
**무엇**: 멀티 플랫폼(Twitter/LinkedIn/Blog)용 스타일 변환 에이전트 + Writing Style Inference

**가져올 핵심 개념**:
```
1. Writing Style Inference: 기존 글을 분석해 자동으로 style 파라미터 추출
2. Platform-aware: 플랫폼별 최적 문체 자동 선택
3. Multi-provider: Google/OpenAI/Anthropic 자동 라우팅
4. Built-in evaluation: 생성된 콘텐츠 품질+스타일 점수화
```

**우리 적용법**:
- `Writing Style Inference` → 우리 기존 글(특히 view_count 높은 것) 분석해 스타일 파라미터 추출
- 블로그/Threads 각각 다른 스타일 적용
- 평가 시스템을 품질 게이트와 통합

---

### 3.3 [Brand-Voice-Architect](https://github.com/Reese-Pallath/Brand-Voice-Architect) 
**무엇**: 브랜드 보이스의 "의미 지도(semantic cartography)" 구축 시스템

**가져올 핵심 개념**:
```
1. Neural Tone Analysis: 단순한 형용사 말고 개념 간 의미 관계 매핑
2. Context-Aware Adaptation: 채널/청중에 따라 어조·격식·감성 조절
3. Seasonal & Trend Adaptation: 핵심 정체성 유지하면서 점진적 문체 진화
4. A/B Testing Analytics: 어떤 문체 변형이 목표 달성에 효과적인지 측정
```

**우리 적용법**:
- A/B 테스트: 같은 주제, 다른 문체로 2개 발행 → engagement 비교
- 계절별 문체 진화: 시즌 트렌드에 맞춰 문체 미세 조정

---

### 3.4 [VibePrompt](https://github.com/mohammedaly22/vibeprompt)
**무엇**: 15+ writing styles + audience targeting 기반 프롬프트 변환 라이브러리

**가져올 핵심 개념**:
```
1. 15+ 미리 정의된 스타일: technical, casual, persuasive 등
2. Audience Targeting: 청중 수준에 따라 콘텐츠 난이도 조절
3. Chain Transformation: 여러 스타일 연속 적용
```

---

### 3.5 [Alignmenter](https://github.com/justinGrosvenor/alignmenter)
**무엇**: AI 출력의 브랜드 보이스 일치도 측정/평가 도구

**가져올 핵심 개념**:
```
1. Authenticity Score: AI 출력이 브랜드 보이스와 얼마나 일치하는지
2. Persona YAML: 브랜드 보이스 선언적 정의 YAML
3. Semantic drift 감지: 시간에 따라 보이스가 흐트러지는지 추적
```

---

## 4. 단계별 구현 로드맵

### Phase 1: Fingerprint 기반 스타일 프로파일 도입 (3일)
**목표**: 하나의 고정 문체에서 다변화 가능한 구조로

**할 일**:
1. `src/lib/brand-fingerprint.ts` 생성
   - stylometric fingerprint JSON 구조 정의
   - 기존 글(특히 높은 view_count) 분석해 초기 fingerprint 생성
   - fingerprint = { sentence_length, paragraph_rhythm, tone_vector, vocabulary_level, punctuation_pattern, emotional_pacing }

2. `BLOG_STYLE_GUIDE` 대신 `getStylePrompt(fingerprint, angleType)` 함수
   - AngleType에 따라 다른 fingerprint 선택
   - 예: `budget` AngleType → 간결한 문장, 실용적 어조 / `luxury` → 우아한 표현, 여유로운 문장

3. 기존 `generatePillar`에 style 지문 조건부 전달

---

### Phase 2: Trend-to-Style 자동 변환 (3일)
**목표**: 트렌드 분석 결과가 자동으로 문체에 반영

**할 일**:
1. Google Trends / SERP 데이터에서 트렌드 키워드 + 스타일 시그널 추출
2. Trend → Style Mapping:
   - "MZ세대", "힙한", "감성" 키워드 증가 → 캐주얼+감성 문체
   - "실속", "꿀팁", "가성비" 키워드 증가 → 간결+실용 문체
   - "럭셔리", "프리미엄" 키워드 증가 → 격식+우아 문체

3. 주간 스타일 캘린더: 요일별 다른 문체 A/B 테스트
   - 월/수/금: 기본 문체
   - 화/목: 실험적 문체
   - 주간 리포트: 어떤 문체가 더 높은 engagement?

---

### Phase 3: 멀티 플랫폼 스타일 자동 적응 (3일)
**목표**: 블로그 ↔ Threads ↔ (향후) 인스타 각각 최적 문체 적용

**할 일**:
1. 플랫폼별 fingerprint 프로파일 생성
   - 블로그: 전문적+정보 밀도 높음
   - Threads: 캐주얼+짧은 문장+이모지
2. `agent-style-transfer` 스타일 추론 + 적용
3. 동일 콘텐츠를 각 플랫폼 문체로 재작성

---

### Phase 4: 피드백 루프 + 추적 (2일)
**목표**: 문체별 성과를 측정해 지속 개선

**할 일**:
1. 각 발행 글에 style_id 태그
2. view_count / click_rate / dwell_time 과 style_id 상관 분석
3. 성과 좋은 style → fingerprint 업데이트 (자동 학습)
4. Alignmenter 방식의 authenticity 점수를 품질 게이트에 추가

---

## 5. 핵심 아키텍처

### brand-fingerprint.ts (Phase 1)

```typescript
// src/lib/brand-fingerprint.ts

export interface StyleFingerprint {
  name: string;                  // 'default' | 'budget' | 'luxury' | 'sentimental'
  tone: {
    formality: number;           // 0.0(casual) ~ 1.0(formal)
    emotionalValence: number;    // 0.0(neutral) ~ 1.0(emotional)
    technicality: number;        // 0.0(simple) ~ 1.0(technical)
  };
  structure: {
    avgSentenceLength: number;   // 평균 문장 길이 (음절)
    paragraphRhythm: string;     // 'short-short-long' | 'balanced' | 'long-form'
    punchlinePattern: string[];  // ['redefinition', 'staccato', 'question']
  };
  vocabulary: {
    level: 'basic' | 'intermediate' | 'advanced';
    bannedWords: string[];       // AI 느낌 나는 금지어
    preferredTerms: Record<string, string>; // 대체 선호 용어
  };
  platform: {
    blog: Partial<StyleFingerprint>;
    threads?: Partial<StyleFingerprint>;
  };
  metadata: {
    sourceArticleIds: string[];  // 이 fingerprint의 근거가 된 글
    generatedAt: string;
    version: number;
  };
}

// 기존 view_count 높은 글에서 fingerprint 추론
export async function inferFingerprintFromArticles(articles: Article[]): Promise<StyleFingerprint>;

// 프롬프트 생성
export function buildStylePrompt(fingerprint: StyleFingerprint): string;

// deviation 측정
export function measureDeviation(text: string, fingerprint: StyleFingerprint): number;
```

### generatePillar 수정 예시

```typescript
// 기존
const stylePrompt = BLOG_STYLE_GUIDE;

// 개선
const fingerprint = await selectFingerprintForTopic(item);
const stylePrompt = buildStylePrompt(fingerprint);
```

---

## 6. 우리가 즉시 할 수 있는 것 (0일 차)

지금 바로 할 수 있는 가장 간단한 것부터:

1. **기존 글 분석**: view_count 1 이상인 글 5개를 골라 문체 특징 분석 (문장 길이, 톤, 패턴)
2. **JSON fingerprint 수동 작성**: 분석 결과를 바탕으로 여소남 브랜드 보이스 정의
3. **AngleType 연동**: 이미 있는 AngleType(budget/sentimental/luxury 등)을 블로그 본문 문체와 연결

---

## 7. 참고: CopyStyle 방식 (Reference-based)

[CopyStyle](https://blog.ax0x.ai/copy-style)의 핵심 통찰:
> "문체를 메뉴에서 고르게 하지 마라. 사용자가 좋아하는 글 하나를 주면, AI가 그 글의 DNA를 추출해서 같은 스타일로 써라."

이걸 우리 서비스에 적용하면:
- "이런 느낌의 글이 좋아요"라고 고객(랜드사/여행사)이 참고글을 주면
- 그 글의 문체 fingerprint를 추출해 해당 브랜드 전용 문체로 발행
- B2B 차별화 포인트: "저희는 파트너사별 맞춤 문체를 제공합니다"

---

*다음 단계: Phase 1 `brand-fingerprint.ts` 구현 및 기존 글 분석으로 초기 fingerprint 생성*
