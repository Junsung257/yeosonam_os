import { describe, expect, it } from 'vitest';
import { inspectBlogIntentQuality } from './blog-content-intent';

describe('blog content intent reading design', () => {
  it('accepts real tables and checklists without requiring highlight marks', () => {
    const report = inspectBlogIntentQuality({
      title: '오사카 7월 날씨와 옷차림 준비',
      primaryKeyword: '오사카 7월 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: [
        '# 오사카 7월 날씨와 옷차림 준비',
        '',
        '오사카 7월은 기온, 습도, 강수량을 같이 봐야 하는 시기입니다.',
        '',
        '## 월별 날씨 요약',
        '| 구분 | 기온 | 준비 |',
        '| --- | --- | --- |',
        '| 낮 | 30도 전후 | 통풍 좋은 옷 |',
        '| 밤 | 25도 전후 | 얇은 겉옷 |',
        '| 비 | 소나기 가능 | 접이식 우산 |',
        '| 실내 | 냉방 강함 | 가벼운 겉옷 |',
        '',
        '## 옷차림 체크리스트',
        '- 반팔',
        '- 얇은 겉옷',
        '- 접이식 우산',
        '- 방수팩',
        '- 편한 신발',
        '',
        '## 우기 주의사항',
        '비 예보가 있으면 야외 이동 시간을 줄이고 실내 일정을 먼저 잡는 편이 좋습니다.',
        '',
        '## 부모님 동반 팁',
        '낮에는 30도 이상으로 오를 수 있어 이동 시간을 30분 단위로 끊어 잡는 것이 좋습니다.',
        '',
        '## FAQ',
        'Q. 오사카 7월 여행은 괜찮나요?',
        'A. 더위와 소나기 대비를 하면 충분히 가능합니다.',
      ].join('\n'),
    });

    expect(report.issues.some((issue) => issue.code === 'weak_reading_design')).toBe(false);
  });
});
