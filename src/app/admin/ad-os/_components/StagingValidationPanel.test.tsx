import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StagingValidation } from '../_lib/types';
import { StagingValidationPanel } from './StagingValidationPanel';

const validationFixture: StagingValidation = {
  ok: true,
  generated_at: '2026-06-05T00:00:00.000Z',
  validation: {
    status: 'pass',
    readiness_score: 92,
    passed: 6,
    warnings: 0,
    failed: 0,
    top_blocker: null,
    next_action: '배포 전 검증은 운영자 확인 준비가 됐습니다.',
    checks: [
      {
        id: 'read-only-smoke',
        label: '읽기 전용 점검',
        status: 'pass',
        evidence: 'DB 변경이나 외부 API 반영이 감지되지 않았습니다.',
        next_action: '이 안전장치를 계속 켜두세요.',
      },
    ],
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
    },
  },
};

describe('Ad OS StagingValidationPanel', () => {
  it('renders validation status, metrics, evidence, and safety gates', () => {
    const html = renderToStaticMarkup(
      <StagingValidationPanel stagingValidation={validationFixture} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('배포 전 검증 패키지');
    expect(html).toContain('배포 전 검증은 운영자 확인 준비가 됐습니다.');
    expect(html).toContain('92%');
    expect(html).toContain('읽기 전용 점검');
    expect(html).toContain('DB 변경이나 외부 API 반영이 감지되지 않았습니다.');
    expect(html).toContain('DB 변경 꺼짐 - 외부 반영 꺼짐 - 완전 자동 꺼짐');
  });

  it('renders the empty state before validation data is loaded', () => {
    const html = renderToStaticMarkup(
      <StagingValidationPanel stagingValidation={null} checking={false} onRefresh={() => {}} />,
    );

    expect(html).toContain('미점검');
    expect(html).toContain('배포 전 검증 상태를 확인하세요.');
    expect(html).toContain('검증을 실행하면 기본 점검');
  });
});
