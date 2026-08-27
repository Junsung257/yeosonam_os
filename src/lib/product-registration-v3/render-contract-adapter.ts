import type { DayInput, HotelInfo, MealInfo, RenderPackageInput } from '@/lib/render-contract';
import { isPublishableStandardNoticeDraft } from './customer-payload';
import { isCustomerOptionalTourCandidate } from '@/lib/customer-option-classifier';
import type { V3DraftLedger, V3LedgerVariant } from './types';

function renderMeal(value: Record<string, unknown>): { enabled: boolean; note: string | null } {
  const raw = typeof value.raw_text === 'string' ? value.raw_text : null;
  const explicitlyExcluded = raw
    ? /(?:\ubd88\s*\ud3ec\ud568|\ubbf8\s*\uc81c\uacf5|\uc5c6\uc74c|N\/?A|:\s*-)\s*$/i.test(raw.trim())
    : false;
  return { enabled: Boolean(raw) && !explicitlyExcluded, note: raw };
}

function renderHotel(value: Record<string, unknown>): HotelInfo {
  const raw = typeof value.raw_text === 'string' ? value.raw_text : null;
  return {
    name: raw,
    grade: null,
    note: raw,
  };
}

function renderDays(sourceDays: V3LedgerVariant['days']): DayInput[] {
  return sourceDays.map(day => {
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
}

function customerTitleFromParts(parts: string[], fallback: string): string {
  const candidates = parts.map(part => part.trim()).filter(Boolean);
  const nonTag = candidates.filter(part => !/^#\s*[^\s#]+(?:\s+#\s*[^\s#]+)*$/u.test(part));
  const productLike = nonTag.find(part =>
    part.length >= 5
    && /(골프|패키지|특가|투어|여행|리조트|크루즈|자유일정|스팟|노팁|노옵션|다색|무제한|박\s*\d+\s*일|\d+\s*박)/u.test(part),
  );
  return productLike ?? nonTag[0] ?? candidates[0] ?? fallback;
}

export function ledgerToRenderPackageInputs(ledger: V3DraftLedger): RenderPackageInput[] {
  return ledger.variants.map(variant => {
    // Daily meals already render from the typed itinerary. Repeating derived
    // meal summaries as policy notices produces awkward or contradictory copy
    // (for example an exclusion line becoming "식사는 중식으로 제공").
    const publishableNotices = variant.standard_notices
      .filter(isPublishableStandardNoticeDraft)
      .filter(notice => notice.category !== 'meal_plan');
    const title = customerTitleFromParts(variant.title_parts, variant.variant_key);
    const ticketingCondition = variant.ticketing_condition ?? null;
    const ticketingNotice = ticketingCondition
      ? {
          type: 'SOURCE_TICKETING_CONDITION',
          title: '발권 조건',
          text: ticketingCondition.customerNotice,
          category: 'ticketing_condition',
          review_status: ticketingCondition.status === 'expired' || ticketingCondition.status === 'conflicting'
            ? 'safe_degraded'
            : 'source_confirmed',
        }
      : null;
    const outbound = variant.flight_segments.find(segment => segment.leg === 'outbound') ?? variant.flight_segments[0];
    const inbound = variant.flight_segments.find(segment => segment.leg === 'inbound') ?? variant.flight_segments[1];
    const days = renderDays(variant.days);
    const durationDays = Number(variant.duration_days);
    const itineraryDayOmissionNotice = Number.isInteger(durationDays)
      && durationDays > 1
      && variant.days.length === durationDays - 1
      ? `원문 여행기간은 ${durationDays}일이며 DAY 표제는 ${variant.days.length}일입니다. 출발·도착일 세부 일정은 상담 시 최종 확인합니다.`
      : null;
    const sourceSheetFallback = (variant as V3LedgerVariant & {
      source_sheet_fallback?: { reason?: string };
    }).source_sheet_fallback?.reason === 'schedule_and_lodging_not_in_source';
    const sourceSheetNotice = sourceSheetFallback
      ? '원문에는 출발·가격·항공 정보가 확인되지만 상세 일정과 숙소는 예약 상담 시 최종 확인합니다.'
      : null;
    return {
      title,
      product_type: 'package',
      ticketing_deadline: ticketingCondition?.deadline ?? null,
      ticketing_deadline_status: ticketingCondition?.status ?? null,
      ticketing_condition: ticketingCondition,
      booking_mode: ticketingCondition?.consultationOnly ? 'consultation_only' : 'standard_inquiry',
      marketing_eligible: ticketingCondition?.marketingEligible ?? true,
      price_dates: variant.price_calendar.map(price => ({
        date: price.date ?? price.label,
        price: price.amount,
        child_price: price.child_amount ?? price.amount,
        infant_price: price.infant_amount ?? undefined,
        infant_consultation_required: price.infant_price_state === 'consultation_required',
        // A dated sale price means the departure can be displayed; it does not
        // by itself prove that the departure is confirmed.  Only an explicit
        // source phrase such as "출발확정" may turn this on.
        confirmed: price.departure_confirmed === true,
        ...(price.list_price != null ? { list_price: price.list_price } : {}),
        ...(price.min_travelers != null ? { min_travelers: price.min_travelers } : {}),
        ...(price.max_travelers != null ? { max_travelers: price.max_travelers } : {}),
        ...(price.price_relation ? { price_relation: price.price_relation } : {}),
        price_note: price.min_travelers != null
          ? price.max_travelers != null && price.max_travelers !== price.min_travelers
            ? `${price.min_travelers}~${price.max_travelers}명 기준`
            : price.max_travelers === price.min_travelers
              ? `${price.min_travelers}명 기준`
              : `${price.min_travelers}명 이상 기준`
          : undefined,
      })),
      airline: outbound?.code.slice(0, 2) ?? inbound?.code.slice(0, 2) ?? null,
      inclusions: variant.inclusions.map(item => item.value),
      excludes: variant.exclusions.map(item => item.value),
      notices_parsed: [...publishableNotices.map(notice => ({
        type: notice.risk_level === 'high' ? 'CRITICAL' : notice.risk_level === 'medium' ? 'POLICY' : 'INFO',
        title: '유의사항',
        text: `• ${notice.standard_text}`,
        category: notice.category,
        template_key: notice.template_key,
        review_status: notice.review_status,
      })), ...(ticketingNotice ? [ticketingNotice] : []), ...(sourceSheetNotice ? [{
        type: 'INFO',
        title: '일정·숙소 안내',
        text: sourceSheetNotice,
        category: 'source_sheet_fallback',
        review_status: 'safe_degraded',
      }] : []), ...(itineraryDayOmissionNotice ? [{
        type: 'INFO',
        title: '일정 안내',
        text: itineraryDayOmissionNotice,
        category: 'itinerary_day_omission',
        review_status: 'safe_degraded',
      }] : [])],
      customer_notes: [
        ...publishableNotices.map(notice => notice.standard_text),
        ...(ticketingCondition ? [ticketingCondition.customerNotice] : []),
        ...(sourceSheetNotice ? [sourceSheetNotice] : []),
        ...(itineraryDayOmissionNotice ? [itineraryDayOmissionNotice] : []),
      ]
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
          ticketing_deadline: ticketingCondition?.deadline ?? null,
          ticketing_deadline_status: ticketingCondition?.status ?? null,
          ticketing_notice: ticketingCondition?.customerNotice ?? null,
        },
        flight_segments: variant.flight_segments.map(segment => ({
          leg: segment.leg === 'inbound' ? 'inbound' as const : 'outbound' as const,
          flight_no: segment.code,
          dep_airport: segment.dep_airport ?? null,
          dep_time: segment.dep_time,
          arr_airport: segment.arr_airport ?? null,
          arr_time: segment.arr_time,
          arr_day_offset: 0 as const,
        })),
        highlights: {
          shopping: variant.shopping[0]?.value ?? null,
          inclusions: variant.inclusions.map(item => item.value),
          excludes: variant.exclusions.map(item => item.value),
        },
        days,
        itinerary_alternatives: variant.itinerary_choices?.map(choice => ({
          label: choice.label,
          consultation_selection_required: true,
          days: renderDays(choice.days),
        })) ?? [],
      },
    };
  });
}
