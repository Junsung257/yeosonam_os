import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicErrorState, { getPublicErrorDebugText } from './PublicErrorState';

const secretError = Object.assign(new Error('SECRET_DATABASE_URL'), {
  digest: 'opaque-digest-123456',
  stack: 'Error: SECRET_DATABASE_URL\n at C:\\private\\server.ts:42:1',
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PublicErrorState production disclosure boundary', () => {
  it('does not render raw message or stack outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const markup = renderToStaticMarkup(
      <PublicErrorState
        error={secretError}
        code="E1001"
        title="페이지를 불러오지 못했습니다"
        action="잠시 후 다시 시도해주세요"
        reset={() => undefined}
      />,
    );

    expect(markup).not.toContain('SECRET_DATABASE_URL');
    expect(markup).not.toContain('private\\server.ts');
    expect(markup).toContain('opaque-d');
  });

  it('keeps raw details available for local development diagnostics', () => {
    expect(getPublicErrorDebugText(secretError, 'development')).toContain('SECRET_DATABASE_URL');
    expect(getPublicErrorDebugText(secretError, 'production')).toBeNull();
  });
});
