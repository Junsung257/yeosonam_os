import { describe, expect, it } from 'vitest';
import { inspectBlogStructure } from './blog-structure-audit';
import { checkStructureIntegrity } from './blog-quality-gate';

describe('blog-structure-audit', () => {
  it('blocks prose that is accidentally rendered as an empty trailing table row', () => {
    const html = `
      <article>
        <h2>1-12월 월별 날씨와 옷차림 개요</h2>
        <table>
          <thead><tr><th>월</th><th>평균 기온</th><th>옷차림</th></tr></thead>
          <tbody>
            <tr><td>3월</td><td>4~13도</td><td>경량 패딩</td></tr>
            <tr>
              <td>3월 범정산은 여전히 영하권입니다. 부모님과 함께 가는 일정이라면 아침 산책은 줄이고 방풍 재킷과 장갑을 준비하세요.</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </article>
    `;

    const report = inspectBlogStructure({ rawMarkdown: html, renderedHtml: html, slug: 'zhangjiajie-weather' });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('table_prose_contamination');
  });

  it('blocks raw directives and aside blocks leaking inside table cells', () => {
    const html = `
      <article>
        <table>
          <tr><th>구분</th><th>내용</th></tr>
          <tr><td><aside class="tip">꿀팁</aside>::: note</td><td>우산 준비</td></tr>
        </table>
      </article>
    `;

    const report = inspectBlogStructure({ rawMarkdown: html, renderedHtml: html });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['table_prose_contamination', 'raw_directive_leak']),
    );
  });

  it('blocks rendered template artifacts and clickbait tone in informational articles', () => {
    const html = `
      <article>
        <h1>해외여행 비상약 체크리스트</h1>
        <p>$1 이 문장 앞에 노출되면 고객 입장에서는 미완성 글로 보입니다.</p>
        <h2>해외여행 비상약 완벽 가이드 TOP 5</h2>
        <p>놓치면 손해인 꿀팁을 정리했습니다.</p>
      </article>
    `;

    const report = inspectBlogStructure({
      rawMarkdown: html,
      renderedHtml: html,
      title: '해외여행 비상약 체크리스트',
      slug: 'travel-medicine-checklist',
      primaryKeyword: '해외여행 비상약',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['render_artifact_leak', 'promotional_info_tone']),
    );
  });

  it('blocks collapsed FAQ headings and duplicated core blocks', () => {
    const html = `
      <article>
        <h2>핵심 요약</h2>
        <p>요약입니다.</p>
        <h2>핵심 요약</h2>
        <p>중복 요약입니다.</p>
        <h2>자주 묻는 질문 Q1. 장마철에도 장가계 여행이 가능한가요?</h2>
        <p>가능하지만 우산이 필요합니다.</p>
      </article>
    `;

    const report = inspectBlogStructure({ rawMarkdown: html, renderedHtml: html });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['heading_shape_invalid', 'duplicate_core_block']),
    );
  });

  it('blocks collapsed checklist items', () => {
    const html = `
      <article>
        <h2>시즌별 필수 아이템 리스트</h2>
        <ul>
          <li>1월에는 롱패딩과 장갑이 필요합니다. 2. 당일 코스 선택 팁 아침 기온이 낮기 때문에 케이블카 시간을 늦추고 점심 이후 일정을 잡는 편이 좋습니다.</li>
        </ul>
      </article>
    `;

    const report = inspectBlogStructure({ rawMarkdown: html, renderedHtml: html });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('checklist_shape_invalid');
  });

  it('accepts readable Korean checklist headings and separate items', () => {
    const html = `
      <article>
        <h2>여행 체크리스트</h2>
        <ul>
          <li>출발일과 항공 시간을 확인합니다.</li>
          <li>숙소 위치와 이동 시간을 함께 봅니다.</li>
          <li>취소 규정과 결제 기한을 저장합니다.</li>
        </ul>
      </article>
    `;

    const report = inspectBlogStructure({
      rawMarkdown: '## 여행 체크리스트\n\n- 출발일 확인\n- 숙소 위치 확인\n- 취소 규정 확인',
      renderedHtml: html,
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('checklist_shape_invalid');
  });

  it('blocks sales-product wording in weather guide articles', () => {
    const html = `
      <article>
        <h1>장가계 날씨와 월별 옷차림</h1>
        <h2>여소남이 이 상품을 고른 이유</h2>
        <p>이 상품은 부모님 여행에 적합합니다.</p>
      </article>
    `;

    const report = inspectBlogStructure({
      rawMarkdown: html,
      renderedHtml: html,
      slug: 'zhangjiajie-weather',
      primaryKeyword: '장가계 날씨',
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('content_type_tone_mismatch');
  });

  it('passes a clean guide table, FAQ, and checklist shape', async () => {
    const source = [
      '# 장가계 날씨와 월별 옷차림',
      '',
      '## 핵심 요약',
      '',
      '장가계는 산악 지형이라 시내와 산 위 기온 차이가 큽니다.',
      '',
      '## 월별 날씨 표',
      '',
      '| 월 | 평균 기온 | 옷차림 |',
      '|---|---|---|',
      '| 4월 | 11~20도 | 얇은 겉옷 |',
      '| 10월 | 13~22도 | 바람막이 |',
      '',
      '## 시즌별 필수 아이템 리스트',
      '',
      '- 우산 또는 방수 재킷',
      '- 미끄럼 방지 운동화',
      '- 얇은 겉옷',
      '',
      '## 자주 묻는 질문',
      '',
      '### Q. 장가계 우기에도 여행할 수 있나요?',
      '',
      '가능하지만 산 위 안개와 계단 미끄럼을 확인해야 합니다.',
    ].join('\n');

    const result = await checkStructureIntegrity({
      blog_html: source,
      slug: 'zhangjiajie-weather',
      primary_keyword: '장가계 날씨',
      blog_type: 'info',
    });

    expect(result.passed).toBe(true);
  });
});
