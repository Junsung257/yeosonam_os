import { describe, expect, it } from 'vitest';

import { buildStandardBlogCtaMarkdown } from './blog-cta';
import { inspectBlogFleetPhraseDrift } from './blog-fleet-phrase-drift';

const repeatedTemplate = (destination: string) => [
  `# ${destination} family budget`,
  '',
  `${destination} 여행 전 먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다. 출발 전 이 세 가지를 같이 보면 일정 변경과 추가 비용을 줄일 수 있습니다.`,
  '',
  '## 핵심 요약',
  '',
  '| 상황 | 먼저 볼 것 | 확인할 점 |',
  '| --- | --- | --- |',
  '| 가족 | 이동 시간 | 아이 컨디션 |',
  '| 예산 | 총액 | 현지 추가비 |',
  '| 첫 방문 | 서류 | 공항 동선 |',
  '',
  '## 상황별 선택 기준',
  '',
  '아이 동반이면 이동 시간을 먼저 줄이는 편이 좋습니다.',
  '',
  '### 내 일정 기준으로 가능 여부 확인',
  '',
  '출발일과 인원을 알려주시면 일정 기준으로 가능 여부를 확인해 드립니다.',
].join('\n');

describe('inspectBlogFleetPhraseDrift', () => {
  it('blocks repeated generic opening formulas across recent posts', () => {
    const report = inspectBlogFleetPhraseDrift([
      { slug: 'bali-budget', title: 'Bali budget', blog_html: repeatedTemplate('발리') },
      { slug: 'cebu-budget', title: 'Cebu budget', blog_html: repeatedTemplate('세부') },
    ]);

    expect(report.status).toBe('block');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'generic_opening_formula', count: 2 }),
      ]),
    );
  });

  it('warns on repeated CTA wording even when the openings differ', () => {
    const post = (slug: string, opening: string) => [
      `# ${slug}`,
      '',
      opening,
      '',
      '## 확인 표',
      '',
      '| 상황 | 준비 | 이유 |',
      '| --- | --- | --- |',
      '| 가족 | 서류 | 공항 대기 줄이기 |',
      '| 예산 | 현금 | 현지 결제 대비 |',
      '| 일정 | 동선 | 이동 피로 줄이기 |',
      '',
      '### 내 일정 기준으로 확인',
      '',
      '출발일과 인원을 알려주시면 일정 기준으로 가능 여부를 확인해 드립니다.',
    ].join('\n');

    const report = inspectBlogFleetPhraseDrift([
      { slug: 'a', blog_html: post('a', '7월 발리는 짧은 비와 더운 낮 시간을 같이 고려해 얇은 겉옷과 방수 파우치를 챙기는 편이 좋습니다.') },
      { slug: 'b', blog_html: post('b', '세부 가족 일정은 공항 이동과 첫날 휴식 시간을 먼저 잡아야 아이 컨디션을 지키기 쉽습니다.') },
      { slug: 'c', blog_html: post('c', '몽골 7월은 낮과 밤의 온도 차이가 커서 반팔보다 겹쳐 입는 옷차림이 안전합니다.') },
    ]);

    expect(report.status).toBe('warn');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'repeated_cta_sentence', count: 3 }),
      ]),
    );
  });

  it('does not collapse varied standard CTA blocks into the same footer signature', () => {
    const post = (slug: string) => [
      `# ${slug}`,
      '',
      `${slug} 여행은 출발 전 예산, 이동, 현지 확인 조건을 나눠 보면 준비 실수를 줄일 수 있습니다.`,
      '',
      '## 판단표',
      '',
      '| 상황 | 먼저 볼 것 | 이유 |',
      '| --- | --- | --- |',
      '| 가족 | 이동 시간 | 체력 부담 확인 |',
      '| 예산 | 현지 지출 | 총액 차이 확인 |',
      '| 첫 방문 | 공식 안내 | 변경 조건 확인 |',
      '',
      buildStandardBlogCtaMarkdown({
        destination: '몽골',
        slug,
        baseUrl: 'https://www.yeosonam.com',
      }),
    ].join('\n');

    const report = inspectBlogFleetPhraseDrift([
      { slug: 'mongolia-food-budget', blog_html: post('mongolia-food-budget') },
      { slug: 'mongolia-shopping-budget', blog_html: post('mongolia-shopping-budget') },
      { slug: 'mongolia-transport-cost', blog_html: post('mongolia-transport-cost') },
    ]);

    expect(report.issues.some((issue) => issue.code === 'repeated_cta_sentence')).toBe(false);
  });
});
