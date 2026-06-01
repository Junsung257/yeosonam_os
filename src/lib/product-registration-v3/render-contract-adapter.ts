import type { RenderPackageInput } from '@/lib/render-contract';
import type { V3DraftLedger } from './types';

export function ledgerToRenderPackageInputs(ledger: V3DraftLedger): RenderPackageInput[] {
  return ledger.variants.map(variant => {
    const title = variant.title_parts[0] || variant.variant_key;
    const outbound = variant.flight_segments.find(segment => segment.leg === 'outbound') ?? variant.flight_segments[0];
    const inbound = variant.flight_segments.find(segment => segment.leg === 'inbound') ?? variant.flight_segments[1];
    return {
      title,
      product_type: 'package',
      duration: variant.duration_days ?? undefined,
      nights: variant.nights ?? undefined,
      price: variant.price_calendar[0]?.amount ?? undefined,
      price_dates: variant.price_calendar.map(price => ({
        date: price.date ?? price.label,
        price: price.amount,
        confirmed: true,
      })),
      airline: outbound?.code.slice(0, 2) ?? inbound?.code.slice(0, 2) ?? null,
      inclusions: variant.inclusions.map(item => item.value),
      excludes: variant.exclusions.map(item => item.value),
      optional_tours: variant.options.map(option => ({
        name: option.normalized_name,
        price: option.price_amount ? `${option.currency ?? ''}${option.price_amount}` : null,
        price_usd: option.currency === 'USD' && option.price_amount ? option.price_amount : undefined,
        region: option.region ?? undefined,
      })),
      itinerary_data: {
        meta: {
          flight_out: outbound?.code ?? null,
          flight_in: inbound?.code ?? null,
          airline: outbound?.code.slice(0, 2) ?? inbound?.code.slice(0, 2) ?? null,
          departure_airport: null,
        },
        highlights: {
          shopping: variant.shopping[0]?.value ?? null,
          inclusions: variant.inclusions.map(item => item.value),
          excludes: variant.exclusions.map(item => item.value),
        },
        days: variant.days.map(day => ({
          day: day.day,
          regions: day.route,
          schedule: day.events.map(event => ({
            type: event.type === 'meeting' ? 'normal' : event.type,
            time: event.time,
            activity: event.raw_text,
            attraction_ids: event.canonical_id ? [event.canonical_id] : undefined,
          })),
          meals: day.meals,
          hotel: day.hotel,
        })),
      },
    } as RenderPackageInput;
  });
}
