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

  it('accepts descriptive day sections without forcing checklist or table markup', () => {
    const report = inspectBlogIntentQuality({
      title: '다낭 3박4일 여행 코스와 이동 동선',
      primaryKeyword: '다낭 3박4일 여행 코스',
      category: 'itinerary',
      contentType: 'guide',
      blogHtml: [
        '# 다낭 3박4일 여행 코스와 이동 동선',
        '',
        '다낭 일정은 장소별 공식 이동 근거를 비교해 날짜별로 나누면 됩니다.',
        '',
        '## 1일차: 린 응 파고다',
        '첫날은 도착 후 휴식을 남겨 두고 운영 여부를 확인합니다.',
        '',
        '## 2일차: 바나힐',
        '바나힐은 별도 하루 일정으로 두고 공식 공지를 확인합니다.',
        '',
        '## 3일차: 마블 마운틴',
        '마블 마운틴의 입장 조건을 확인한 뒤 남쪽 동선을 결정합니다.',
        '',
        '## 4일차: 호이안',
        '비가 오면 호이안 블록을 대체 일정으로 조정합니다.',
      ].join('\n'),
    });

    expect(report.issues).not.toContainEqual(expect.objectContaining({
      code: 'weak_list_or_table_shape',
    }));
    expect(report.issues).not.toContainEqual(expect.objectContaining({
      code: 'weak_reading_design',
    }));
  });

  it('does not require a weather table when decision coverage is present in sections', () => {
    const report = inspectBlogIntentQuality({
      title: '다낭 10월 날씨와 옷차림',
      primaryKeyword: '다낭 10월 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: [
        '# 다낭 10월 날씨와 옷차림',
        '',
        '다낭 10월은 비 예보와 체감 기온을 확인해 야외 일정을 줄일지 결정합니다.',
        '',
        '## 10월 비와 우기 판단',
        '출발 직전 공식 예보를 확인하고 비가 오면 실내 일정으로 조정합니다.',
        '',
        '## 낮과 밤 옷차림',
        '기온과 냉방 환경에 맞춰 얇은 겉옷과 방수 신발을 선택합니다.',
        '',
        '## 우천 대체 일정',
        '강수 위험이 높으면 이동 시간을 줄이고 실내 후보를 고릅니다.',
      ].join('\n'),
    });

    expect(report.issues).not.toContainEqual(expect.objectContaining({
      code: 'weak_list_or_table_shape',
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
