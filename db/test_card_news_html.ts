/**
 * @file db/test_card_news_html.ts
 *
 * 카드뉴스 HTML 생성기 시범 호출 CLI.
 *
 * 사용:
 *   npx tsx --env-file=.env.local db/test_card_news_html.ts mongolia
 *   npx tsx --env-file=.env.local db/test_card_news_html.ts phuquoc
 *
 * 결과는 scratch/<fixture>_<timestamp>.html 로 저장.
 * 브라우저에서 직접 열어서 육안 확인.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCardNewsHtml, type GenerateInput } from '../src/lib/card-news-html/generate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

type AngleHint = NonNullable<GenerateInput['angleHint']>;

const FIXTURES: Record<string, GenerateInput> = {
  mongolia: {
    productMeta: {
      title: '몽골 4박5일 - 내 돈 안 쓰는 호화호특',
      destination: '몽골 (울란바토르 + 테를지)',
      nights: 4,
      duration: 5,
      price: 1199000,
      highlights: ['부산 직항 전세기', '5성급 호텔 4박', '노팁·노옵션·노쇼핑', '전 식사 포함'],
      departureDates: ['5월 23일(목)', '5월 27일(월)'],
    },
    angleHint: 'value' satisfies AngleHint,
    toneHint: '신뢰 있는 가성비 + 부산 출발 직항 프리미엄',
    rawText: `부산 김해 출발 직항 전세기 몽골 4박5일

기사·가이드팁 100% 포함 / 노옵션 / 노쇼핑
추가 지출 0원, 마음 편한 호화호특!

가격: 119만9천원~ (1인 기준, 인천출발 대비 직항 프리미엄)
출발일: 5월 23일(목), 5월 27일(월) — 선착순 마감 임박

[포함]
- 왕복 직항 항공 (부산-울란바토르)
- 4박 5성급 호텔 (블루 스카이 또는 동급)
- 매 끼니 지정 식사 (현지 한식·몽골 전통식·바베큐 포함)
- 전 일정 전용차량 + 한국어 가이드
- 가이드/기사 팁 100% 포함
- 입장료, 여행자보험

[일정]
1일차: 부산 김해 → 울란바토르 도착 → 호텔 체크인
2일차: 울란바토르 시내 (간단사원, 자이산 전망대, 수흐바타르 광장) → 민속 공연 관람
3일차: 테를지 국립공원 (거북바위, 게르 체험, 승마 또는 낙타 체험) → 전통 허르헉 만찬
4일차: 보그드 한 궁전 박물관, 자수궁 사원, 캐시미어 매장, 자유 시간
5일차: 호텔 조식 → 부산 귀국

[불포함] 개인경비, 선택 옵션 없음

[문의] 카카오톡 채널 검색: 여소남`,
  },

  phuquoc: {
    productMeta: {
      title: '베트남 푸꾸옥 3박5일 - 5성 노옵션 스페셜',
      destination: '베트남 푸꾸옥',
      nights: 3,
      duration: 5,
      price: 749000,
      highlights: ['5성급 특급 리조트', '노옵션 구성', '남·북부 투어 4대 특전', '부산 직항'],
      departureDates: ['5월 7일(수)', '5월 8일(목)'],
    },
    angleHint: 'luxury' satisfies AngleHint,
    toneHint: '럭셔리 + 가성비 양립 (5성을 이 가격에)',
    rawText: `부산 직항 베트남 푸꾸옥 3박5일 5성 스페셜

가격: 5/7 출발 749,000원 / 5/8 출발 799,000원 (1인, 유류할증료 약 24만원 포함)

[포함]
- 국제선 항공 (LJ 119/120, 19:55 출발 / 07:45 귀국)
- 5성 특급 리조트 3박 (빈펄 메리어트 또는 동급, 2인 1실)
- 호텔 조식 3회 + 한식·해산물·무한 삼겹살 (현지식 포함)
- 전 일정 전용차량 + 한국어 가이드
- 관광지 입장료, 여행자보험

[남부 특전]
1. 핀퀘리 → 사이공 해상 케이블카 (왕복 40분, 아쿠아토피아 워터파크 무료)
2. 키스오브드래곤 관람 (분수쇼 + 야시장)

[북부 특전]
3. 빈펄 사파리 (아시아 최대 규모)
4. 그랜드 월드 나이트 투어 (베네치아풍 + 야시장)

[일정 요약]
1일차: 부산 → 푸꾸옥 도착, 호텔 체크인
2일차: 핀퀘리·키스오브드래곤 + 전신 마사지 90분
3일차: 빈펄 사파리·그랜드 월드 나이트
4일차: 시내관광 + 호국사·코코넛감옥·쇼핑 후 공항 이동
5일차: 부산 도착 (07:45)

[조건] 4월 30일 이내 발권 한정 특가
[문의] 카카오톡 채널 검색: 여소남`,
  },
};

async function main() {
  const arg = (process.argv[2] || 'mongolia') as keyof typeof FIXTURES;
  const fixture = FIXTURES[arg];
  if (!fixture) {
    console.error(`Unknown fixture: ${arg}. Available: ${Object.keys(FIXTURES).join(', ')}`);
    process.exit(1);
  }

  console.log(`▶ 생성 시작: ${arg}`);
  console.log(`  상품: ${fixture.productMeta?.title ?? '(no title)'}`);
  console.log(`  모델: claude-sonnet-4-6 / thinking budget 4000 / cache enabled`);
  console.log('');

  const t0 = Date.now();
  const result = await generateCardNewsHtml(fixture);
  const dt = Date.now() - t0;

  const outDir = path.resolve(ROOT, 'scratch');
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const htmlPath = path.join(outDir, `${arg}_${stamp}.html`);
  const metaPath = path.join(outDir, `${arg}_${stamp}.meta.json`);

  await fs.writeFile(htmlPath, result.html, 'utf8');
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        model: result.model,
        usage: result.usage,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        thinkingPreview: result.thinking.slice(0, 3000),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`✅ 생성 완료 (${(dt / 1000).toFixed(1)}s)`);
  console.log(`  HTML: ${path.relative(ROOT, htmlPath)}`);
  console.log(`  Meta: ${path.relative(ROOT, metaPath)}`);
  console.log('');
  console.log(`  토큰 사용:`);
  console.log(`    input        : ${result.usage.input_tokens}`);
  console.log(`    output       : ${result.usage.output_tokens}`);
  console.log(`    cache_write  : ${result.usage.cache_creation_input_tokens}`);
  console.log(`    cache_read   : ${result.usage.cache_read_input_tokens}`);
  console.log(`  비용 추정: $${result.costUsd.toFixed(4)} (≈ ${Math.round(result.costUsd * 1400)}원)`);
  console.log('');
  console.log(`  브라우저에서 열기:`);
  console.log(`    file:///${htmlPath.replace(/\\/g, '/')}`);
}

main().catch((e) => {
  console.error('❌ 생성 실패');
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
