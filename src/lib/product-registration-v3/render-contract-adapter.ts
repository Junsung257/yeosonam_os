import type { DayInput, HotelInfo, MealInfo, RenderPackageInput } from '@/lib/render-contract';
import { isPublishableStandardNoticeDraft } from './customer-payload';
import { isCustomerOptionalTourCandidate } from '@/lib/customer-option-classifier';
import type { V3DraftLedger } from './types';

function renderMeal(value: Record<string, unknown>): { enabled: boolean; note: string | null } {
  const raw = typeof value.raw_text === 'string' ? value.raw_text : null;
  return { enabled: Boolean(raw), note: raw };
}

function renderHotel(value: Record<string, unknown>): HotelInfo {
  const raw = typeof value.raw_text === 'string' ? value.raw_text : null;
  return {
    name: raw,
    grade: null,
    note: raw,
  };
}

export function ledgerToRenderPackageInputs(ledger: V3DraftLedger): RenderPackageInput[] {
  return ledger.variants.map(variant => {
    const publishableNotices = variant.standard_notices.filter(isPublishableStandardNoticeDraft);
    const title = variant.title_parts[0] || variant.variant_key;
    const outbound = variant.flight_segments.find(segment => segment.leg === 'outbound') ?? variant.flight_segments[0];
    const inbound = variant.flight_segments.find(segment => segment.leg === 'inbound') ?? variant.flight_segments[1];
    const days: DayInput[] = variant.days.map(day => {
      const breakfast = renderMeal(day.meals.breakfast);
      const lunch = renderMeal(day.meals.lunch);
      const dinner = renderMeal(day.meals.dinner);
      const meals: MealInfo = {
        breakfast: breakfast.enabled,
        lunch: lunch.enabled,
        dinner: dinner.enabled,
        breakfast_note: breakfast.note,
        lunch_note: lunch.note,
        dinner_note: dinner.note,
      };
      return {
        day: day.day,
        regions: day.route,
        schedule: day.events
          .filter(event => event.type !== 'price_noise')
          .map(event => ({
            type: event.type === 'meeting' || event.type === 'activity' ? 'normal' : event.type,
            time: event.time,
            activity: event.raw_text,
            attraction_ids: event.canonical_id ? [event.canonical_id] : undefined,
          })),
        meals,
        hotel: renderHotel(day.hotel),
      };
    });
    return {
      title,
      product_type: 'package',
      price_dates: variant.price_calendar.map(price => ({
        date: price.date ?? price.label,
        price: price.amount,
        confirmed: true,
      })),
      airline: outbound?.code.slice(0, 2) ?? inbound?.code.slice(0, 2) ?? null,
      inclusions: variant.inclusions.map(item => item.value),
      excludes: variant.exclusions.map(item => item.value),
      notices_parsed: publishableNotices.map(notice => ({
        type: notice.risk_level === 'high' ? 'CRITICAL' : notice.risk_level === 'medium' ? 'POLICY' : 'INFO',
        title: '유의사항',
        text: `• ${notice.standard_text}`,
        category: notice.category,
        template_key: notice.template_key,
        review_status: notice.review_status,
      })),
      customer_notes: publishableNotices
        .map(notice => notice.standard_text)
        .join('\n'),
      optional_tours: variant.options
        .filter(option => isCustomerOptionalTourCandidate([
          option.raw_name,
          option.normalized_name,
          option.price_amount ? `${option.currency ?? ''}${option.price_amount}` : '',
        ].join(' ')))
        .map(option => ({
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
        flight_segments: variant.flight_segments.map(segment => ({
          leg: segment.leg === 'inbound' ? 'inbound' as const : 'outbound' as const,
          flight_no: segment.code,
          dep_airport: null,
          dep_time: segment.dep_time,
          arr_airport: null,
          arr_time: segment.arr_time,
          arr_day_offset: 0 as const,
        })),
        highlights: {
          shopping: variant.shopping[0]?.value ?? null,
          inclusions: variant.inclusions.map(item => item.value),
          excludes: variant.exclusions.map(item => item.value),
        },
        days,
      },
    };
  });
}
