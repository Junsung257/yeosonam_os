import { describe, expect, it } from 'vitest';
import { inspectBlogIntentQuality } from './blog-content-intent';

describe('blog content intent reading design', () => {
  it('accepts an actionable three-section itinerary without a fixed H2 minimum', () => {
    const report = inspectBlogIntentQuality({
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      primaryKeyword: '다낭 여행 일정과 이동 동선',
      category: 'itinerary',
      contentType: 'guide',
      blogHtml: [
        '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
        '',
        '다낭 일정은 남쪽, 도심, 북쪽을 하루씩 묶어 이동 부담을 줄이는 순서로 결정하면 됩니다.',
        '',
        '## 첫째 날: 남쪽 동선',
        '- 오행산을 먼저 확인합니다.',
        '- 다음 장소로 이동합니다.',
        '',
        '## 둘째 날: 도심 동선',
        '- 숙소에서 가까운 장소부터 고릅니다.',
        '- 저녁 이동은 한 구간으로 줄입니다.',
        '',
        '## 셋째 날: 북쪽 동선',
        '- 먼 구간은 하루에 묶습니다.',
        '- 출발 전에 공식 운영 안내를 다시 확인합니다.',
      ].join('\n'),
    });

    expect(report.issues).not.toContainEqual(expect.objectContaining({
      code: 'weak_reading_design',
      severity: 'critical',
    }));
  });

  it('accepts real tables and checklists without requiring highlight marks', () => {
    const report = inspectBlogIntentQuality({
      title: '오사카 7월 날씨와 옷차림 준비',
      primaryKeyword: '오사카 7월 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: [
        '# 오사카 7월 날씨와 옷차림 준비',
        '',
        '오사카 7월은 덥고 습하지만, 얇은 옷차림과 접이식 우산을 준비하면 여행 가능합니다. 낮 이동은 줄이고 실내 휴식 시간을 먼저 잡는 것이 좋습니다.',
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
