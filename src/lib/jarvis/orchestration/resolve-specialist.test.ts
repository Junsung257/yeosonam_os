import { describe, expect, it } from 'vitest';
import { resolveSpecialist } from './resolve-specialist';
import type { JarvisContext } from '../types';

const ctx: JarvisContext = {
  tenantId: 'tenant-1',
  userRole: 'tenant_admin',
  surface: 'admin',
};

describe('Jarvis marketing specialist routing', () => {
  it('routes campaign planning, performance, copy, reporting, and search-term tasks separately', () => {
    expect(resolveSpecialist('marketing', '다낭 가족 패키지 캠페인 기획하고 타깃 오퍼 잡아줘', ctx).specialistId)
      .toBe('marketing.campaign_planner');
    expect(resolveSpecialist('marketing', 'ROAS가 왜 떨어졌는지 CPA CTR CVR 기준으로 진단해줘', ctx).specialistId)
      .toBe('marketing.performance_analyst');
    expect(resolveSpecialist('marketing', '광고 후킹 카피와 헤드라인 소재 뽑아줘', ctx).specialistId)
      .toBe('marketing.copywriter');
    expect(resolveSpecialist('marketing', '광고주 주간 보고서 리포트 만들어줘', ctx).specialistId)
      .toBe('marketing.reporter');
    expect(resolveSpecialist('marketing', '검색어 보고서 보고 negative 제외 키워드 후보 정리해줘', ctx).specialistId)
      .toBe('marketing.search_term_diagnostician');
  });
});
