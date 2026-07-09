import { describe, expect, it } from 'vitest';
import { inspectPublicBlogCustomerQuality } from './blog-public-customer-quality';

function page(body: string, title = '발리 7월 날씨 옷차림 체크리스트') {
  return `<!doctype html><html><head><title>${title}</title></head><body><main><article>${body}</article></main></body></html>`;
}

describe('inspectPublicBlogCustomerQuality', () => {
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
});
