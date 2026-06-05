import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JarvisRagStatusCard from './JarvisRagStatusCard';

describe('JarvisRagStatusCard', () => {
  it('renders a visible loading state before the live RAG audit response arrives', () => {
    const html = renderToStaticMarkup(<JarvisRagStatusCard />);

    expect(html).toContain('Jarvis Knowledge Index');
    expect(html).toContain('Loading');
    expect(html).toContain('Loading live RAG audit status.');
  });
});
