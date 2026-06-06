import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusPill } from './StatusPill';

describe('Ad OS StatusPill', () => {
  it('renders tone classes and content', () => {
    const html = renderToStaticMarkup(<StatusPill tone="bad">blocked</StatusPill>);

    expect(html).toContain('blocked');
    expect(html).toContain('bg-rose-50');
    expect(html).toContain('text-rose-700');
  });
});
