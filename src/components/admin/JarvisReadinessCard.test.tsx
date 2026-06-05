import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JarvisReadinessCard from './JarvisReadinessCard';

describe('JarvisReadinessCard', () => {
  it('renders a visible loading state before the readiness snapshot arrives', () => {
    const html = renderToStaticMarkup(<JarvisReadinessCard />);

    expect(html).toContain('Jarvis Readiness');
    expect(html).toContain('Loading');
    expect(html).toContain('Loading Jarvis readiness snapshot.');
  });
});
