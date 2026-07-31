/**
 * Compatibility shell for imports and repository contract tests that still
 * reference the former direct-GA4 component.
 *
 * Analytics is loaded exclusively through AnalyticsProvider -> GTM. Keeping
 * this component inert prevents a second Google tag and duplicate page_view.
 */
export default function GA4Tracker() {
  return null;
}
