import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectRenderedBlogIntegrity, removeUnreachableBlogAssetImages, renderBlogContentToHtml } from './blog-renderer';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('blog-renderer', () => {
  it('renders stored markdown that includes safe inline figcaption HTML', async () => {
    const source = [
      '# 장가계 날씨 가이드',
      '',
      '## 핵심 요약',
      '',
      '![장가계 핵심 요약](https://images.pexels.com/photos/1.jpeg)',
      '<figcaption>장가계 핵심 요약</figcaption>',
      '',
      '- 산 정상은 시내보다 10도 낮습니다.',
      '- [관련 패키지 보기](/packages?destination=zhangjiajie)',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<h2');
    expect(html).toContain('<img');
    expect(html).toContain('/api/blog/image?src=');
    expect(html).not.toContain('src="https://images.pexels.com');
    expect(html).toContain('<figcaption>');
    expect(html).toContain('<a href="/packages?destination=zhangjiajie"');
    expect(html).not.toContain('![장가계 핵심 요약]');
    expect(html).not.toContain('[관련 패키지 보기]');
    expect(report.passed).toBe(true);
  });

  it('reports literal markdown artifacts when a rendered body skipped markdown parsing', () => {
    const source = [
      '## 핵심 요약',
      '![장가계 핵심 요약](https://images.pexels.com/photos/1.jpeg)',
    ].join('\n');
    const brokenHtml = `<div>${source}<figcaption>장가계 핵심 요약</figcaption></div>`;

    const report = inspectRenderedBlogIntegrity(source, brokenHtml);

    expect(report.passed).toBe(false);
    expect(report.evidence.artifacts).toEqual(
      expect.arrayContaining(['literal_markdown_image', 'literal_markdown_heading', 'missing_rendered_images']),
    );
  });

  it('splits question-answer prose that was accidentally rendered as a heading', async () => {
    const source = [
      '### 예약 전 무엇을 먼저 확인해야 할까요? 답부터 말하면, 2026년 기준 비용·일정·준비 조건을 함께 확인해야 현지에서 생기는 추가 부담을 줄일 수 있습니다. 포함/불포함과 이동 시간까지 같이 보면 1~2시간의 불필요한 이동을 줄이는 데 도움이 됩니다.',
      '',
      '본문입니다.',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<h3>예약 전 무엇을 먼저 확인해야 할까요?</h3>');
    expect(html).toContain('<p>답부터 말하면, <strong class="num">2026년</strong> 기준 비용·일정·준비 조건');
    expect(html).not.toContain('같이 보면 1~2시간의 불필요한 이동을 줄이는 데 도움이 됩니다.</h3>');
    expect(report.passed).toBe(true);
  });

  it('keeps Supabase blog asset images without remote checks by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const html = '<p><img src="https://example.supabase.co/storage/v1/object/public/blog-assets/post/image.jpg" alt="hero"></p>';

    await expect(removeUnreachableBlogAssetImages(html)).resolves.toBe(html);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('can remove unreachable Supabase blog asset images when remote validation is explicitly enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const html = '<p><img src="https://example.supabase.co/storage/v1/object/public/blog-assets/post/image.jpg" alt="hero"></p><p>body</p>';

    const cleaned = await removeUnreachableBlogAssetImages(html, { validateRemote: true, timeoutMs: 50 });

    expect(cleaned).not.toContain('<img');
    expect(cleaned).toContain('<p>body</p>');
  });

  it('recovers legacy posts where headings, images, and dividers were collapsed into one line', async () => {
    const source = [
      '## 장가계 날씨 가이드 도입 문장입니다. [관련 패키지 보기](/packages) ## 핵심 요약 ![장가계 핵심 요약](https://images.pexels.com/photos/1.jpeg)',
      '<figcaption>장가계 핵심 요약</figcaption> - 첫 번째 요약 - 두 번째 요약 --- ## 여소남이 고른 이유 ![장가계 이유](https://images.pexels.com/photos/2.jpeg)',
      '<figcaption>장가계 이유</figcaption> 본문입니다.',
    ].join(' ');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect((html.match(/<h2/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((html.match(/<img/g) || []).length).toBe(2);
    expect(html).not.toContain('## 핵심 요약');
    expect(html).not.toContain('![장가계 이유]');
    expect(report.passed).toBe(true);
  });

  it('splits overlong legacy H1 bodies before the page demotes them to H2', async () => {
    const source = '# 장가계, 범정산, 동인대협곡, 봉황고성 월별 날씨와 옷차림: 여행 달력 한 장이면 준비 끝 산 위는 17도, 시내는 30도입니다. [관련 패키지 보기](/packages) ## 핵심 요약';

    const html = await renderBlogContentToHtml(source);

    expect(html).toContain('<h2');
    expect(html).toContain('장가계, 범정산, 동인대협곡, 봉황고성 월별 날씨와 옷차림</h2>');
    expect(html).toContain('<p>여행 달력 한 장이면 준비 끝');
    expect(html).not.toContain('관련 패키지 보기 ## 핵심 요약</h2>');
  });

  it('recovers table rows collapsed with spaces between pipe rows', async () => {
    const source = [
      '## 월별 날씨',
      '겨울 설명입니다.|항목|1월|2월| |---|---|---| |평균 최고|2℃|4℃| |평균 최저|-4℃|-2℃|옷차림 설명입니다.',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('<td>평균 최고</td>');
    expect(html).not.toContain('|---');
    expect(report.passed).toBe(true);
  });

  it('separates prose that was accidentally prefixed with a table pipe', async () => {
    const source = [
      '## 3~4월',
      '|봄의 시작 3월 평균 6℃입니다.|항목|3월|4월||---|---|---||평균 최고|9℃|15℃|',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<p>봄의 시작');
    expect(html).toContain('평균');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>항목</th>');
    expect(html).not.toContain('|---');
    expect(report.passed).toBe(true);
  });

  it('recovers collapsed aligned table separators', async () => {
    const source = [
      '좋은 시기입니다.|월|날씨 특징|옷차림||:------|:----------------|:----------||1월|건기|반팔|',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('>월</th>');
    expect(html).not.toContain(':------');
    expect(report.passed).toBe(true);
  });

  it('normalizes overlong generated table separator cells', async () => {
    const source = [
      '항공 안내 |구분|내용||:---|:--------------------------------------------------------------------------------------------------------------------------------||항공|직항|',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).not.toContain('----------------------------------------------------------------');
    expect(report.passed).toBe(true);
  });

  it('recovers rows that were appended after pathological separator lines', async () => {
    const source = [
      '|:---|:--------------------------------------------------------------|구분|내용|',
      '|:---|:--------------------------------------------------------------|**비행시간**|직항 5시간|',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('비행시간');
    expect(html).not.toContain(':--------------------------------------------------------------');
    expect(report.passed).toBe(true);
  });

  it('promotes two-dash generated separators into valid markdown tables', async () => {
    const source = '쾌적합니다.|월별|평균 기온|옷차림||:--|:----------|:----| |1월|-5℃|패딩|';

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('월별');
    expect(html).not.toContain(':--');
    expect(report.passed).toBe(true);
  });

  it('expands short separator rows to match the header cell count', async () => {
    const source = '설명입니다.|월|날씨|기온|옷차림||---|---|---||1월|건기|30℃|반팔|';

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('옷차림');
    expect(html).not.toContain('|---');
    expect(report.passed).toBe(true);
  });

  it('renders markdown links even when Korean particles were attached', async () => {
    const source = '[방콕 우기 시즌 호텔 할인 정보](https://www.yeosonam.com/packages?destination=bangkok)도 미리 확인하세요.';

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<a href="https://www.yeosonam.com/packages?destination=bangkok"');
    expect(html).not.toContain('[방콕 우기 시즌 호텔 할인 정보]');
    expect(report.passed).toBe(true);
  });

  it('keeps markdown lists and links renderable after inline figcaption HTML', async () => {
    const source = [
      '## 핵심 요약',
      '![호화호특](https://images.pexels.com/photos/1.jpeg)',
      '<figcaption>호화호특 핵심 요약</figcaption>',
      '- 평균 기온 15~28℃',
      '- [관련 패키지 보기](https://www.yeosonam.com/packages) 다음 섹션',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<ul>');
    expect(html).toContain('<a href="https://www.yeosonam.com/packages"');
    expect(html).not.toContain('[관련 패키지 보기]');
    expect(report.passed).toBe(true);
  });

  it('removes decorative bold markers even when legacy content wrapped inside them', async () => {
    const source = [
      '## 옷차림',
      '* **추천',
      '옷차림**: 얇은 반팔과 가디건을 준비하세요.',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);

    expect(html).not.toContain('**추천');
    expect(html).toContain('추천 옷차림');
  });

  it('removes decorative bold markers around bracketed legacy headings', async () => {
    const html = await renderBlogContentToHtml('**[3박 4일 추천 일정 알찬 휴양과 핵심 관광]**');

    expect(html).not.toContain('**');
    expect(html).toContain('추천 일정 알찬 휴양과 핵심 관광]');
  });
  it('normalizes generated strikethrough markers instead of rendering deletion lines', async () => {
    const source = '## 옷차림\n\n~~얇은 실내복도 챙기시면 호텔에서 쾌적하게 지내실 수 있습니다.~~';

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('얇은 실내복도 챙기시면');
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('~~');
    expect(report.passed).toBe(true);
  });

  it('renders residual markdown links even when the label wraps across lines', async () => {
    const source = '[세부\n6월 맞춤 패키지 보기](https://www.yeosonam.com/packages?destination=cebu)';

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<a href="https://www.yeosonam.com/packages?destination=cebu">세부 6월 맞춤 패키지 보기</a>');
    expect(html).not.toContain('[세부');
    expect(report.passed).toBe(true);
  });
});
