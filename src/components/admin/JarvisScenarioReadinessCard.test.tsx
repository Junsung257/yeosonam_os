import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JarvisScenarioReadinessCard from './JarvisScenarioReadinessCard';

describe('JarvisScenarioReadinessCard', () => {
  it('renders a visible loading state before the all-scenario snapshot arrives', () => {
    const html = renderToStaticMarkup(<JarvisScenarioReadinessCard />);

    expect(html).toContain('All-Scenario Readiness');
    expect(html).toContain('Loading');
    expect(html).toContain('Loading all-scenario readiness snapshot.');
  });
});
