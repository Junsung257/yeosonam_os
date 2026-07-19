import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const boundaryFiles = [
  'src/app/global-error.tsx',
  'src/app/error.tsx',
  'src/app/packages/error.tsx',
  'src/app/destinations/error.tsx',
  'src/app/blog/error.tsx',
];

describe('public error boundary disclosure contract', () => {
  it.each(boundaryFiles)('%s delegates customer rendering to the safe shared state', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    const renderSource = source.slice(source.lastIndexOf('return ('));

    expect(source).toContain('PublicErrorState');
    expect(renderSource).not.toContain('error.message');
    expect(renderSource).not.toContain('error.stack');
  });

  it('preserves production Sentry reporting for the global boundary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/global-error.tsx'), 'utf8');
    expect(source).toContain('Sentry.captureException(error)');
  });

  it('preserves server-side blog error reporting without rendering its stack', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/blog/error.tsx'), 'utf8');
    expect(source).toContain("fetch('/api/blog/report-error'");
    expect(source).toContain('stack: stack?.slice(0, 2000)');
  });
});
