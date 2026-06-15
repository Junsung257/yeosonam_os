import { describe, expect, it } from 'vitest';

import {
  aggregateUploadVerifyResults,
  toUploadVerifyPackageResult,
  uploadVerifyErrorResult,
  type UploadVerifyPackageResult,
} from './upload-verify-aggregate';
import type { VerifyResult } from './upload-verify';

function result(status: VerifyResult['status'], counts: Partial<Pick<VerifyResult, 'passCount' | 'warnCount' | 'failCount'>> = {}): VerifyResult {
  return {
    status,
    checks: [
      {
        id: status,
        label: `check ${status}`,
        status: status === 'blocked' ? 'fail' : status === 'warnings' ? 'warn' : 'pass',
      },
    ],
    fixable: [],
    passCount: counts.passCount ?? (status === 'clean' ? 1 : 0),
    warnCount: counts.warnCount ?? (status === 'warnings' ? 1 : 0),
    failCount: counts.failCount ?? (status === 'blocked' ? 1 : 0),
  };
}

function packageResult(packageId: string, status: VerifyResult['status']): UploadVerifyPackageResult {
  return toUploadVerifyPackageResult(packageId, result(status));
}

describe('aggregateUploadVerifyResults', () => {
  it('keeps a single clean package clean', () => {
    const aggregate = aggregateUploadVerifyResults([packageResult('pkg-1', 'clean')]);

    expect(aggregate.status).toBe('clean');
    expect(aggregate.packageResults).toHaveLength(1);
    expect(aggregate.passCount).toBe(1);
    expect(aggregate.checks[0].id).toBe('pkg-1:clean');
  });

  it('keeps multi-package uploads clean only when every package is clean', () => {
    const aggregate = aggregateUploadVerifyResults([
      packageResult('pkg-1', 'clean'),
      packageResult('pkg-2', 'clean'),
      packageResult('pkg-3', 'clean'),
    ]);

    expect(aggregate.status).toBe('clean');
    expect(aggregate.packageResults.map(item => item.packageId)).toEqual(['pkg-1', 'pkg-2', 'pkg-3']);
  });

  it('promotes any blocked package to the whole upload status', () => {
    const aggregate = aggregateUploadVerifyResults([
      packageResult('pkg-1', 'clean'),
      packageResult('pkg-2', 'blocked'),
      packageResult('pkg-3', 'warnings'),
    ]);

    expect(aggregate.status).toBe('blocked');
    expect(aggregate.failCount).toBe(1);
    expect(aggregate.warnCount).toBe(1);
  });

  it('surfaces package-level verify errors when no package is blocked', () => {
    const aggregate = aggregateUploadVerifyResults([
      packageResult('pkg-1', 'clean'),
      uploadVerifyErrorResult('pkg-2', '검증 실패 - 상품 없음'),
    ]);

    expect(aggregate.status).toBe('error');
    expect(aggregate.failCount).toBe(1);
    expect(aggregate.packageResults[1]).toMatchObject({
      packageId: 'pkg-2',
      status: 'error',
      error: '검증 실패 - 상품 없음',
    });
  });
});
