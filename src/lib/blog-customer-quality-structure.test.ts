import { describe, expect, it } from 'vitest';
import { inspectBlogCustomerQuality } from './blog-customer-quality';

describe('inspectBlogCustomerQuality structure strictness', () => {
  it('fails duplicate headings because they read like an assembled template', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      destination: '세부',
      primaryKeyword: '세부 가족여행',
      blogHtml: [
        '# 세부 가족여행',
        '',
        '세부 가족여행은 이동 시간, 숙소 위치, 아이 휴식 시간을 먼저 맞추면 일정 실패를 줄일 수 있습니다.',
        '',
        '## 1일 차',
        '',
        '공항 도착 후 숙소 이동과 저녁 식사만 잡습니다.',
        '',
        '## 2일 차',
        '',
        '리조트와 가까운 일정으로 체력을 아낍니다.',
        '',
        '## 2일 차',
        '',
        '같은 제목이 다시 붙으면 고객에게 자동 조립 글처럼 보입니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('overbuilt_mechanical_structure');
  });

  it('fails articles with too many headings before public render amplifies the problem', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      destination: '발리',
      primaryKeyword: '발리 여행 준비',
      blogHtml: [
        '# 발리 여행 준비',
        '',
        '발리 여행은 날씨, 이동, 예산, 준비물을 먼저 나누면 현지에서 다시 확인할 일이 줄어듭니다.',
        '',
        ...Array.from({ length: 12 }, (_, index) => [
          `## 판단 기준 ${index + 1}`,
          '',
          '고객이 바로 결정할 수 있는 본문입니다.',
        ].join('\n')),
      ].join('\n\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('overbuilt_mechanical_structure');
  });
});
