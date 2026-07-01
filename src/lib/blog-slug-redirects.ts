export const BLOG_SLUG_REDIRECTS: Record<string, string> = {
  '7-bali': 'bali-july-weather-checklist',
  'post-hv01': 'travel-emergency-medicine-summer-checklist',
  '7-top-5': 'europe-july-cool-cities-top-5',
  '7-weather': 'sydney-july-winter-weather-guide',
  'visa-2026': 'vietnam-visa-entry-documents-2026',
  '6-nagasaki': 'nagasaki-travel-cost-preparation-tips-2026',
  'hohhot-6': 'hohhot-monthly-weather-clothes-2026',
  'nagasaki-34': 'nagasaki-budget-cost-guide-2026',
  'danang-best': 'danang-budget-cost-guide-2026',
  'danang-34': 'danang-itinerary-route-guide-2026',
  'bohol-34': 'bohol-budget-cost-guide-2026',
  'nagasaki-6': 'nagasaki-monthly-weather-clothes-2026',
  'post-yd8p': 'summer-travel-insurance-coverage-guide-2026',
  'vs-vs-esim-7': 'overseas-roaming-usim-esim-comparison-2026',
  '7-guide-f4aa5972': 'europe-independent-travel-tips-july-2026',
  'post-uo8h': 'summer-airport-crowding-departure-tips-2026',
  '7-post-s3gj': 'july-overseas-flight-ticket-booking-tips-2026',
  '태국-입국-시-필요한-서류와-면세-한도-총정리-2026년-기준-재작성-v2': 'thailand-entry-documents-duty-free-2026',
};

export function resolveBlogSlugRedirect(slug: string): string | null {
  return BLOG_SLUG_REDIRECTS[slug] ?? null;
}
