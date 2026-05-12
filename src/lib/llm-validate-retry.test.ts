/**
 * @file llm-validate-retry.test.ts
 * @description callWithZodValidation + Self-Refine (P1-4) 회귀 방지.
 *
 * 시나리오:
 *  1. 첫 응답 정상 — critic 미정의 → 1회 호출, 통과
 *  2. 첫 응답 정상 — critic 통과 (null 반환) → 1회 호출, 통과
 *  3. 첫 응답 정상이지만 critic 거부 → 재호출 (feedback에 critique 포함)
 *  4. critic 2회 연속 거부 → maxRefineRounds=1 이라 첫 거부만 재시도, 그 후 통과
 *  5. JSON 파싱 실패 → feedback 에 parse 에러 메시지 + 재시도
 *  6. Zod 위반 → feedback 에 issue 목록 + 재시도
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { callWithZodValidation } from './llm-validate-retry';

const SimpleSchema = z.object({
  title: z.string().min(1),
  hasInsurance: z.boolean(),
});

describe('callWithZodValidation — Self-Refine (P1-4)', () => {
  it('정상 응답 + critic 없음 → 1회 호출 통과', async () => {
    const fn = vi.fn().mockResolvedValue('{"title":"OK","hasInsurance":false}');
    const r = await callWithZodValidation({
      label: 'test1',
      schema: SimpleSchema,
      fn,
      maxAttempts: 3,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.value.title).toBe('OK');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('정상 응답 + critic 통과(null) → 1회 호출, fn 에 feedback null 전달', async () => {
    const fn = vi.fn().mockResolvedValue('{"title":"안전","hasInsurance":false}');
    const critic = vi.fn().mockResolvedValue(null);
    const r = await callWithZodValidation({
      schema: SimpleSchema,
      fn,
      criticOnSuccess: critic,
      maxAttempts: 3,
    });
    expect(r.success).toBe(true);
    expect(critic).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(null);
  });

  it('critic 거부 → fn 재호출 (feedback에 critique 포함), 두 번째 응답 통과', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce('{"title":"3억 보험 포함","hasInsurance":true}')
      .mockResolvedValueOnce('{"title":"3억 보험 표기 제거","hasInsurance":false}');
    const critic = vi.fn().mockImplementation((parsed) =>
      parsed.hasInsurance ? '원문에 없는 보험 환각' : null,
    );

    const r = await callWithZodValidation({
      schema: SimpleSchema,
      fn,
      criticOnSuccess: critic,
      maxAttempts: 3,
      maxRefineRounds: 1,
    });

    expect(r.success).toBe(true);
    if (r.success) expect(r.value.hasInsurance).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
    // 2번째 호출 시 feedback 에 critique 포함됐는지
    expect(fn.mock.calls[1][0]).toContain('원문에 없는 보험 환각');
  });

  it('maxRefineRounds=1 — critic 두 번째 호출에서 거부해도 더 이상 재정제 안 함', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce('{"title":"first","hasInsurance":true}')
      .mockResolvedValueOnce('{"title":"second","hasInsurance":true}');
    // critic 항상 거부 — maxRefineRounds=1 이라 1회만 재시도 후 통과
    const critic = vi.fn().mockImplementation((parsed) =>
      parsed.hasInsurance ? '여전히 보험 표기' : null,
    );

    const r = await callWithZodValidation({
      schema: SimpleSchema,
      fn,
      criticOnSuccess: critic,
      maxAttempts: 3,
      maxRefineRounds: 1,
    });

    // refine 1회만 → 두 번째 응답에 critic이 호출되지 않고 그대로 통과
    expect(r.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(critic).toHaveBeenCalledTimes(1); // 첫 응답에서만 critic 호출
  });

  it('JSON 파싱 실패 → feedback 에 parse 에러 메시지 + 재시도', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce('this is not json')
      .mockResolvedValueOnce('{"title":"OK","hasInsurance":false}');
    const r = await callWithZodValidation({
      schema: SimpleSchema,
      fn,
      maxAttempts: 3,
    });
    expect(r.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toMatch(/JSON|에러/);
  });

  it('Zod 위반 → feedback 에 issue 목록 + 재시도', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce('{"title":"","hasInsurance":false}') // empty title fail
      .mockResolvedValueOnce('{"title":"fixed","hasInsurance":false}');
    const r = await callWithZodValidation({
      schema: SimpleSchema,
      fn,
      maxAttempts: 3,
    });
    expect(r.success).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toContain('title');
  });
});
