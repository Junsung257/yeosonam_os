/**
 * brand_kits 시드 스크립트 — TrendStyle 엔진 기반 초기 voice_guide 설정
 *
 * 실행: npx ts-node db/scripts/seed-brand-voice-fingerprint.ts
 *
 * 목적:
 *   기존 brand_kits.voice_guide 를 TrendStyle fingerprint 기반으로 업데이트.
 *   Threads/블로그 각 플랫폼 + AngleType별 문체 가이드를 DB에 저장.
 *
 * stylometric-transfer (GitHub ⭐) 의 fingerprint 구조를
 * brand_kits.voice_samples + voice_guide 형식에 맞게 변환.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Threads 플랫폼별 voice_guide 템플릿 ─────────────────────────────────────

const VOICE_GUIDES: Record<string, { guide: string; samples: Array<{ platform: string; content: string; performance_score: number }> }> = {
  'yeosonam-threads-default': {
    guide: `## 여소남 Threads 브랜드 보이스 (TrendStyle 자동 생성)

### 성격
- 1인칭 "저/제가" 기반 대화체
- 솔직하고 과장 없는 톤
- 친구한테 여행 추천해주는 느낌

### 금지 표현
- "솔직히" (말하면 솔직하지 않아 보임)
- "놀라운", "완벽한" (AI 티 남)
- "대박" (클리셰)
- 느낌표 연속 사용 (!!!)

### 권장 패턴
- 첫 문장: 개인적 경험/질문으로 시작
- 중간: 구체적 사실/숫자
- 마무리: DM 유도 (전환 최고)
- 이모지: 1~2개만, 자연스럽게
- 해시태그: 1~3개 (너무 많이 X)

### 문장 길이
- 평균 30~40음절
- 짧은 문장 여러 개 → 긴 문장 한 개 리듬
- 한 줄 단락 자주 사용 (engagement 좋음)

### CTA
- "DM으로 '키워드' 보내주세요" (전환 최고)
- 댓글 질문은 engagement용

### 주의
- Threads는 X(트위터) 느낌. Instagram 캡션처럼 단정하지 말 것
- 알고리즘은 '참여 유도 질문'을 좋아함`,
    samples: [],
  },
  'yeosonam-threads-budget': {
    guide: `## 여소남 Threads 가성비 모드

### 성격
- 가격/혜택 중심
- 간결하고 직설적
- 숫자로 신뢰감

### 핵심 문법
- 첫 줄에 가격/할인율 먼저
- "~에 비하면", "~보다 저렴" 비교 구조
- CTA: "DM으로 '가성비' 보내주세요"

### 금지
- 장황한 설명
- 감성적 표현 과다`,
    samples: [],
  },
  'yeosonam-threads-sentimental': {
    guide: `## 여소남 Threads 감성/힐링 모드

### 성격
- 따뜻하고 공감 가는 톤
- 경험/감정 중심 서술
- 여유로운 문장 리듬

### 핵심 문법
- "저는 ○○할 때 ○○를 느꼈어요" 형식
- 질문형 후크로 공감 유도
- CTA: "여러분의 경험도 댓글로 공유해주세요"

### 금지
- 너무 영업적인 표현
- 숫자/가격 먼저 내세우기`,
    samples: [],
  },
  'yeosonam-threads-luxury': {
    guide: `## 여소남 Threads 프리미엄 모드

### 성격
- 세련되고 우아한 톤
- 정보 밀도 높음
- 과장 없는 자신감

### 핵심 문법
- "사실 ○○는..." 호기심 유발형
- 구체적 디테일로 신뢰
- CTA: 프로필 링크 안내 (DM 유도보다 부드럽게)

### 금지
- "싼", "저렴한" 같은 표현
- 과도한 이모지/느낌표
- 가격 할인 강조`,
    samples: [],
  },
  'yeosonam-threads-adventure': {
    guide: `## 여소남 Threads 모험/액티브 모드

### 성격
- 에너제틱하고 도전적인 톤
- 경험 공유/후기 중심
- 가벼운 유머 허용

### 핵심 문법
- 강한 주장으로 시작 ("○○ 안 가보면 후회합니다")
- 짧은 문장 연속으로 속도감
- 구체적 에피소드로 설득
- CTA: "댓글로 ○○ 가본 분?"`,
    samples: [],
  },
};

async function main() {
  console.log('brand_kits TrendStyle fingerprint 시드 시작...\n');

  for (const [code, data] of Object.entries(VOICE_GUIDES)) {
    // 기존 레코드 확인
    const { data: existing } = await supabase
      .from('brand_kits')
      .select('id, voice_samples')
      .eq('code', code)
      .maybeSingle();

    if (existing) {
      // voice_guide만 업데이트 (voice_samples는 기존 학습 데이터 유지)
      const { error } = await supabase
        .from('brand_kits')
        .update({
          voice_guide: data.guide,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as unknown as { id: string }).id);

      if (error) {
        console.error(`  ❌ ${code} 업데이트 실패:`, error.message);
      } else {
        console.log(`  ✅ ${code} voice_guide 업데이트 완료`);
      }
    } else {
      // 새 레코드 생성
      const { error } = await supabase
        .from('brand_kits')
        .insert({
          code,
          brand_name: code.replace('yeosonam-', '여소남 ').replace(/-/g, ' '),
          is_active: true,
          voice_guide: data.guide,
          voice_samples: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.error(`  ❌ ${code} 생성 실패:`, error.message);
      } else {
        console.log(`  ✅ ${code} 신규 생성 완료`);
      }
    }
  }

  // 기존 yeosonam (threads_post) 도 최신 가이드로 업데이트
  const { data: oldKit } = await supabase
    .from('brand_kits')
    .select('id')
    .eq('code', 'yeosonam')
    .maybeSingle();

  if (!oldKit) {
    const { error } = await supabase
      .from('brand_kits')
      .insert({
        code: 'yeosonam',
        brand_name: '여소남',
        is_active: true,
        voice_guide: VOICE_GUIDES['yeosonam-threads-default']!.guide,
        voice_samples: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    if (error) {
      console.error('  ❌ yeosonam 생성 실패:', error.message);
    } else {
      console.log('  ✅ yeosonam 신규 생성 완료');
    }
  }

  console.log('\n✅ 모든 brand_kits 시드 완료');
  console.log('이제 generateThreadsPost() 호출 시 TrendStyle 엔진이');
  console.log('트렌드 키워드 + angleType 기반으로 자동 문체 변환을 적용합니다.');
}

main().catch(console.error);