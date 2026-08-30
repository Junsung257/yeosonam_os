import { describe, expect, it } from 'vitest';
import {
  inspectPublicBlogCustomerQuality,
  requiresHydratedPublicBlogAudit,
} from './blog-public-customer-quality';

function page(body: string, title = '발리 7월 날씨 옷차림 체크리스트'): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main><article>${body}</article></main></body></html>`;
}

describe('inspectPublicBlogCustomerQuality', () => {
  it('requires browser hydration when the raw Next.js stream still has pending article boundaries', () => {
    const html = page(`
      <div aria-label="목차">목차 (16)</div>
      <template id="P:4"></template>
    `) + '<script>$RS=function(a,b){};$RS("S:4","P:4")</script>';

    expect(requiresHydratedPublicBlogAudit(html)).toBe(true);
  });

  it('does not hydrate an already materialized article body', () => {
    const html = page(`
      <template id="P:4"></template>
      <div class="prose-blog"><p>완성된 공개 본문입니다.</p></div>
    `) + '<script>$RS=function(a,b){};$RS("S:4","P:4")</script>';

    expect(requiresHydratedPublicBlogAudit(html)).toBe(false);
  });

  it('blocks broken public table surfaces that look fine to technical URL checks', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>몽골 7월 날씨 옷차림 여행 준비물 체크리스트</h1>
        <p>몽골 7월 날씨는 낮에는 25도 안팎, 밤에는 10도까지 내려갈 수 있어 얇은 긴팔과 겉옷을 함께 준비해야 합니다.</p>
        <h2>7월 기온/강수/습도 표</h2>
        <hr><hr><hr>
        <p>울란바토르 25도 12도 65mm 9일 60%</p>
        <p>고비 사막 30도 15도 20mm 4일 35%</p>
        <p>홉스골 20도 8도 70mm 12일 70%</p>
      `),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('broken_table_surface');
  });

  it('does not call ordinary numeric prose or standalone separators a broken table', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>몽골 숙소와 교통 비용 가이드</h1>
        <p>울란바토르 시내는 1박 7만 원부터, 외곽 게르는 1박 5만 원대부터 시작합니다.</p>
        <hr><hr><hr><hr>
        <div>
          <p>울란바토르 시내 호텔은 조식과 이동 동선을 함께 비교해야 합니다.</p>
          <p>고비 이동은 차량 시간과 휴식 간격을 먼저 확인해야 합니다.</p>
        </div>
        <table><thead><tr><th>구분</th><th>비용</th></tr></thead><tbody>
          <tr><td>시내</td><td>7만 원부터</td></tr>
          <tr><td>외곽</td><td>5만 원대부터</td></tr>
        </tbody></table>
      `, '몽골 숙소와 교통 비용 가이드'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('broken_table_surface');
  });

  it('does not reject numeric supporting prose when a real public table is present', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>몽골 숙소와 교통 비용 가이드</h1>
        <p>울란바토르 시내는 1박 7만 원부터, 외곽 게르는 1박 5만 원대부터 시작합니다.</p>
        <p>울란바토르 시내 호텔은 1박 70,000원부터 120,000원이고 조식 1회를 포함합니다.</p>
        <p>울란바토르 시내 교통은 버스 500투그릭, 식사는 5,000원부터 10,000원입니다.</p>
        <table><thead><tr><th>구분</th><th>비용</th></tr></thead><tbody>
          <tr><td>시내</td><td>7만 원부터</td></tr>
          <tr><td>외곽</td><td>5만 원대부터</td></tr>
        </tbody></table>
      `, '몽골 숙소와 교통 비용 가이드'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('broken_table_surface');
  });

  it('catches generated residue and placeholder copy in visible text', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>발리 7월 날씨 옷차림 체크리스트</h1>
        <p>발리 7월은 건기라 비가 적고 낮에는 덥지만, 실내 냉방과 이동 시간을 고려해 얇은 겉옷을 챙기는 편이 좋습니다.</p>
        <p>(첫 번째) 이 섹션은 주로 팁 위주라 구체적인 수치보다는 흐름을 설명합니다.</p>
        <p>#현지 #현지정보 #현지자유여행</p>
      `),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('generated_residue');
    expect(report.issues.map((issue) => issue.code)).toContain('placeholder_copy');
  });

  it('does not call evidence sentences duplicates when their numeric values differ', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>괌 월별 날씨 옷차림 체크리스트</h1>
        <p>괌 날씨는 월별 기온과 강수량을 함께 보고 옷차림을 정해야 합니다.</p>
        <p>1월 최고기온은 29.0도, 최저기온은 24.0도, 강수량은 100.0mm입니다.</p>
        <p>2월 최고기온은 29.1도, 최저기온은 24.1도, 강수량은 120.0mm입니다.</p>
        <p>3월 최고기온은 29.2도, 최저기온은 24.2도, 강수량은 140.0mm입니다.</p>
      `, '괌 월별 날씨 옷차림 체크리스트'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('duplicate_public_section');
  });

  it('blocks info posts that answer with reservation talk before the reader question', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>발리 7월 날씨 옷차림 체크리스트</h1>
        <p>2026년 7월 기준, 발리 여행은 먼저 상품 가격과 예약 가능 여부를 확인해야 예산 오차를 줄일 수 있습니다.</p>
        <p>발리 7월은 건기라 비가 적은 편입니다. 낮에는 반팔, 실내와 저녁에는 얇은 겉옷을 준비하세요.</p>
      `),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('info_answer_mismatch');
  });

  it('treats luggage and flight-delay language as transport when the title is an airport route', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>괌 공항 투몬 교통: 택시 요금·승차 위치·수하물·항공 지연 대응</h1>
        <p>대중교통 요금을 확인하려면 GRTA 항목을, 현지 택시 요금·공항 승차 위치와 카카오 T 괌택시의 수하물·항공 지연 대응을 확인하려면 택시 항목을 보면 됩니다.</p>
        <h2>대중교통 요금</h2>
        <p>공식 요금표와 운행표는 출발 전에 다시 확인하고, 자신의 숙소와 가까운 정류장을 표시해 두세요. 도착 시각이 바뀌면 다음 운행편을 공식 채널에서 확인하면 됩니다.</p>
        <h2>택시 승차와 요금</h2>
        <p>공항 택시 카운터 위치와 현지 미터요금을 따로 확인하세요. 예약 서비스를 쓸 때는 예약 화면의 최종 요금과 차량 조건을 함께 확인해야 합니다.</p>
        <h2>수하물과 지연 대응</h2>
        <p>캐리어 개수와 비행편 정보를 먼저 정리하면 차량 조건을 확인하기 쉽습니다. 출발 전에는 공항과 운송사 공식 안내를 각각 다시 확인하세요.</p>
        <p>숙소 위치에 따라 마지막 이동 구간이 달라질 수 있으므로, 하차 지점부터 숙소 출입구까지의 동선도 지도에서 확인하세요.</p>
      `, '괌 공항 투몬 교통: 택시 요금·승차 위치·수하물·항공 지연 대응'),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('info_answer_mismatch');
  });

  it('passes a concise customer-first informational article', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <h1>발리 7월 날씨 옷차림 체크리스트</h1>
        <p>발리 7월은 건기라 비가 적고 낮에는 덥습니다. 반팔 위주로 준비하되, 냉방이 강한 차량과 식당을 대비해 얇은 긴팔이나 가디건 하나를 챙기면 충분합니다.</p>
        <h2>먼저 확인할 것</h2>
        <p>숙소 지역, 해양 액티비티 여부, 아이 동반 여부에 따라 준비물이 달라집니다. 꾸따나 스미냑처럼 이동이 잦은 일정은 얇고 빨리 마르는 옷이 편하고, 우붓처럼 숲과 계단 이동이 많은 일정은 미끄럽지 않은 신발이 더 중요합니다.</p>
        <h2>상황별 준비물</h2>
        <table><thead><tr><th>상황</th><th>준비물</th><th>이유</th></tr></thead><tbody><tr><td>해변</td><td>래시가드</td><td>자외선 차단</td></tr><tr><td>차량 이동</td><td>얇은 겉옷</td><td>냉방 대비</td></tr><tr><td>아이 동반</td><td>상비약</td><td>현지 구매 변수</td></tr></tbody></table>
        <h2>출발 전 확인</h2>
        <p>입국 조건과 항공 수하물 기준은 출발 전 공식 안내로 다시 확인하세요. 액체류, 보조배터리, 유심 수령 장소처럼 공항에서 바로 필요한 항목은 출발 전날 한 번 더 확인하는 편이 안전합니다.</p>
        <p>비가 적은 달이라도 짧은 소나기는 올 수 있으니 접이식 우산보다 가벼운 방수 재킷이 이동 중에는 더 편합니다. 아이와 함께라면 해열제, 지사제, 모기 기피제처럼 현지에서 브랜드를 찾기 어려운 약은 한국에서 챙기는 편이 좋습니다.</p>
        <p>일정이 짧다면 준비물을 많이 늘리기보다 하루 이동 동선에 맞춰 필요한 것만 줄이는 방식이 낫습니다. 리조트 중심 일정은 수영복과 자외선 차단이 우선이고, 액티비티 중심 일정은 여벌 옷과 방수팩이 더 중요합니다.</p>
        <p>내 일정 기준으로 준비물과 이동 조건을 확인하고 싶다면 상담에서 출발일과 인원만 알려주세요.</p>
      `),
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(88);
  });

  it('does not treat numbered itinerary day headings as duplicates', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'product',
      html: page(`
        <h1>Cebu family itinerary</h1>
        <p>Cebu family trips are easier when airport movement, hotel location, and child rest time are checked first.</p>
        <h2>1일 차</h2><p>Arrive and move to the hotel.</p>
        <h2>2일 차</h2><p>Keep the first activity short.</p>
        <h2>3일 차</h2><p>Use the morning for a light route.</p>
        <h2>4일 차</h2><p>Leave enough time before the flight.</p>
      `),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('duplicate_heading');
  });

  it('still catches truly repeated headings in the article body', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'product',
      html: page(`
        <h1>Cebu family itinerary</h1>
        <p>Cebu family trips are easier when airport movement, hotel location, and child rest time are checked first.</p>
        <h2>2일 차</h2><p>Keep the first activity short.</p>
        <h2>2일 차</h2><p>This repeated day section should be caught.</p>
      `),
    });

    expect(report.issues.map((issue) => issue.code)).toContain('duplicate_heading');
  });

  it('ignores table of contents and recommendation headings outside the body', () => {
    const report = inspectPublicBlogCustomerQuality({
      expectedType: 'info',
      html: page(`
        <nav aria-label="목차"><h3>2일 차</h3><h3>3일 차</h3></nav>
        <h1>Cebu travel prep</h1>
        <p>Cebu travel prep should start with documents, airport movement, budget, and weather checks.</p>
        <h2>2일 차</h2><p>Use a short route.</p>
        <h2>3일 차</h2><p>Check return timing.</p>
        <aside aria-label="추천 포스팅"><h3>2일 차</h3><h3>3일 차</h3></aside>
      `),
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('duplicate_heading');
  });
});
