import { describe, expect, it } from 'vitest';
import { checkLength, checkLinks } from './blog-quality-gate';
import { repairPublishReadiness } from './blog-publish-readiness-repair';

describe('blog publish readiness repair', () => {
  it('adds neutral support without body CTA when the renderer owns informational CTA', () => {
    const source = [
      '# 세부 쇼핑 예산 선물 리스트와 면세점 체크',
      '',
      '세부 쇼핑 예산은 선물, 면세점, 현지 마트 가격을 나눠서 보면 판단이 쉽습니다. '.repeat(45),
      '',
      '## 예산 체크',
      '',
      '| 항목 | 확인 기준 |',
      '| --- | --- |',
      '| 선물 | 수량과 무게 |',
      '| 면세점 | 출국장 재고 |',
      '| 마트 | 결제 수단 |',
      '',
      '## 공식 확인',
      '',
      '- [외교부 해외안전여행](https://www.0404.go.kr/)',
      '- [인천국제공항](https://www.airport.kr/)',
    ].join('\n');

    expect(checkLength(source, 'info').passed).toBe(false);
    expect(checkLinks(source).passed).toBe(false);

    const result = repairPublishReadiness({
      markdown: source,
      blogType: 'info',
      hasRuntimeInformationalCta: true,
      slug: 'cebu-shopping-budget-checklist',
      destination: '세부',
      topic: '세부 쇼핑 예산 선물 리스트와 면세점 체크',
      primaryKeyword: '세부 쇼핑 예산',
    });

    expect(result.changes).toEqual(['appended_publish_readiness_support']);
    expect(checkLength(result.markdown, 'info').passed).toBe(true);
    expect(checkLinks(result.markdown).passed).toBe(false);
    expect(result.markdown).toContain('## 출발 전 다시 확인할 기준');
    expect(result.markdown).not.toContain('/packages?');
  });

  it('restores the final length floor after later cleanup trims an existing support section', () => {
    const prefix = [
      '# 미국 입국 요건과 비자',
      '',
      '미국 입국 조건은 여행자 국적과 방문 목적을 기준으로 공식 안내에서 확인합니다.',
      '',
      '## 출발 전 다시 확인할 기준',
      '',
    ].join('\n');
    const targetLength = 2495;
    const filler = '공식 안내의 확인일과 적용 대상을 비교합니다. ';
    let source = prefix;
    while (source.length < targetLength) source += filler;

    const result = repairPublishReadiness({
      markdown: source,
      blogType: 'info',
      hasRuntimeInformationalCta: true,
      slug: 'us-entry-requirements',
      destination: '미국',
      topic: '미국 입국 요건과 비자',
      primaryKeyword: '미국 입국 요건과 비자',
    });

    expect(result.changes).toEqual(['extended_publish_readiness_support']);
    expect(checkLength(result.markdown, 'info').passed).toBe(true);
    expect(result.markdown.match(/## 출발 전 다시 확인할 기준/g)).toHaveLength(1);
  });
});
