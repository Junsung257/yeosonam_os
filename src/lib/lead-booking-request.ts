import crypto from 'crypto';
import { createBooking, findOrCreateCustomerByPhone, supabaseAdmin } from '@/lib/supabase';
import { getEffectivePriceDates } from '@/lib/price-dates';
import { dispatchPushAsync } from '@/lib/push-dispatcher';
import { enqueueSeatCheckRequiredTask } from '@/lib/booking-workflow-tasks';

export interface LandingBookingForm {
  desiredDate: string;
  adults: number;
  children: number;
  name: string;
  phone: string;
  privacyConsent: boolean;
  termsConsent?: boolean;
}

export interface LandingBookingTracking {
  sessionId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingUrl?: string | null;
  intent?: string | null;
  budget?: string | null;
  destination?: string | null;
  party_type?: string | null;
  selected_products?: string[] | null;
  ready_count?: number | null;
  missing_fields?: string[] | null;
  decision_summary?: string | null;
  handoff_preview?: string | null;
}

export interface CreateLandingBookingRequestInput {
  productId: string;
  channel?: string | null;
  form: LandingBookingForm;
  tracking?: LandingBookingTracking | null;
  chatSessionId?: string | null;
  leadId?: string | null;
  affiliateRef?: string | null;
  idempotencyKey?: string | null;
}

export type LandingBookingReplay = {
  booking: {
    id: string;
    booking_no: string | null;
    status: string | null;
    idempotency_key: string | null;
  };
  customerId: null;
  idempotentReplay: true;
};

type PackageRow = {
  id: string;
  title: string | null;
  price: number | null;
  cost_price: number | null;
  price_dates?: unknown;
  price_list?: unknown;
  price_tiers?: unknown;
  destination: string | null;
  affiliate_commission_rate: number | null;
  land_operator: string | null;
  land_operator_id: string | null;
  products?:
    | { internal_code?: string | null; departure_region?: string | null }
    | Array<{ internal_code?: string | null; departure_region?: string | null }>
    | null;
};

type AffiliateRow = {
  id: string;
  grade: number | null;
  bonus_rate: number | null;
  created_at: string | null;
};

function digitsOnly(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deterministicUuidFromText(value: string): string {
  const hex = crypto.createHash('sha256').update(value).digest('hex');
  const bytes = hex.slice(0, 32).split('');
  bytes[12] = '5';
  bytes[16] = ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
  const id = bytes.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

function makeIdempotencyKey(input: CreateLandingBookingRequestInput): string {
  return deterministicUuidFromText([
    'landing-booking',
    input.productId,
    input.form.desiredDate,
    input.form.adults,
    input.form.children,
    digitsOnly(input.form.phone),
  ].join('|'));
}

function normalizeBookingIdempotencyKey(value: string | null | undefined, input: CreateLandingBookingRequestInput): string {
  const raw = value?.trim();
  if (!raw) return makeIdempotencyKey(input);
  return UUID_RE.test(raw) ? raw : deterministicUuidFromText(raw);
}

export async function findExistingLandingBookingReplay(
  input: CreateLandingBookingRequestInput,
): Promise<LandingBookingReplay | null> {
  const idempotencyKey = normalizeBookingIdempotencyKey(input.idempotencyKey, input);
  const { data: existing, error } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, status, idempotency_key')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  if (!existing) return null;
  return { booking: existing, customerId: null, idempotentReplay: true };
}

function pickProductsCode(products: PackageRow['products']): string | undefined {
  if (Array.isArray(products)) return products[0]?.internal_code ?? undefined;
  return products?.internal_code ?? undefined;
}

function pickDepartureRegion(products: PackageRow['products']): string | undefined {
  if (Array.isArray(products)) return products[0]?.departure_region ?? undefined;
  return products?.departure_region ?? undefined;
}

function resolveUnitPrice(pkg: PackageRow, desiredDate: string): number {
  const effective = getEffectivePriceDates(pkg as Parameters<typeof getEffectivePriceDates>[0]);
  const exact = effective.find(d => d.date === desiredDate && typeof d.price === 'number' && d.price > 0);
  if (exact?.price) return exact.price;
  const positive = effective.map(d => d.price).filter((n): n is number => typeof n === 'number' && n > 0);
  if (positive.length > 0) return Math.min(...positive);
  return Number(pkg.price ?? 0) || 0;
}

async function resolveAffiliateCommission(input: {
  affiliateRef: string | null | undefined;
  packageRow: PackageRow;
  adultCount: number;
  childCount: number;
  adultPrice: number;
  childPrice: number;
}) {
  if (!input.affiliateRef) return null;

  const { data: affiliate, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, grade, bonus_rate, created_at')
    .eq('referral_code', input.affiliateRef)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  if (!affiliate) return null;

  const affiliateRow = affiliate as AffiliateRow;
  const { applyCommissionPolicies } = await import('@/lib/policy-engine');
  const productRate = Number(input.packageRow.affiliate_commission_rate);
  const baseRate = Number.isFinite(productRate) && productRate >= 0 ? productRate : 0.02;
  const daysSinceSignup = affiliateRow.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(affiliateRow.created_at).getTime()) / 86400000))
    : 0;

  const breakdown = await applyCommissionPolicies({
    product_id: input.packageRow.id,
    destination: input.packageRow.destination ?? undefined,
    affiliate_id: affiliateRow.id,
    affiliate_grade: affiliateRow.grade ?? 1,
    days_since_signup: daysSinceSignup,
    base_rate: baseRate,
    tier_bonus: Math.max(0, Number(affiliateRow.bonus_rate ?? 0)),
  });
  const commissionBase = input.adultCount * input.adultPrice + input.childCount * input.childPrice;

  return {
    affiliateId: affiliateRow.id,
    influencerCommission: Math.round(commissionBase * breakdown.final_rate),
    appliedTotalCommissionRate: breakdown.final_rate,
    commissionBreakdown: {
      ...breakdown,
      source: 'landing_lead',
      referral_code: input.affiliateRef,
    } satisfies Record<string, unknown>,
    };
}

function normalizeTrackingText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTrackingList(value: string[] | null | undefined, maxItems = 12, maxLength = 80): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value ?? []) {
    const text = item.trim().slice(0, maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

function buildLandingBookingHandoffContext(tracking: LandingBookingTracking | null | undefined) {
  return {
    intent: normalizeTrackingText(tracking?.intent),
    budget: normalizeTrackingText(tracking?.budget),
    destination: normalizeTrackingText(tracking?.destination),
    party_type: normalizeTrackingText(tracking?.party_type),
    selected_products: normalizeTrackingList(tracking?.selected_products),
    ready_count: typeof tracking?.ready_count === 'number' ? tracking.ready_count : null,
    missing_fields: normalizeTrackingList(tracking?.missing_fields),
    decision_summary: normalizeTrackingText(tracking?.decision_summary),
    handoff_preview: normalizeTrackingText(tracking?.handoff_preview),
  };
}

export async function createLandingBookingRequest(input: CreateLandingBookingRequestInput) {
  if (!input.productId) throw new Error('productId is required');
  if (!input.form?.name || !input.form?.phone || !input.form?.privacyConsent) {
    throw new Error('required customer fields are missing');
  }

  const idempotencyKey = normalizeBookingIdempotencyKey(input.idempotencyKey, input);
  const replay = await findExistingLandingBookingReplay(input);
  if (replay) return replay;

  const [{ data: pkg, error: pkgErr }, customerId] = await Promise.all([
    supabaseAdmin
      .from('travel_packages')
      .select(
        'id, title, price, cost_price, price_dates, price_list, price_tiers, destination, affiliate_commission_rate, land_operator, land_operator_id, products(internal_code, departure_region)',
      )
      .eq('id', input.productId)
      .maybeSingle(),
    findOrCreateCustomerByPhone(input.form.phone, input.form.name),
  ]);

  if (pkgErr) throw pkgErr;
  if (!pkg) throw new Error('상품을 찾을 수 없습니다.');
  if (!customerId) throw new Error('고객 연락처 저장에 실패했습니다.');

  const packageRow = pkg as PackageRow;
  const adultCount = Math.max(1, Number(input.form.adults) || 1);
  const childCount = Math.max(0, Number(input.form.children) || 0);
  const adultPrice = resolveUnitPrice(packageRow, input.form.desiredDate);
  const adultCost = Number(packageRow.cost_price ?? 0) || 0;
  const childPrice = adultPrice;
  const childCost = adultCost;
  const totalPeople = adultCount + childCount;
  const internalCode = pickProductsCode(packageRow.products);
  const affiliateCommission = await resolveAffiliateCommission({
    affiliateRef: input.affiliateRef,
    packageRow,
    adultCount,
    childCount,
    adultPrice,
    childPrice,
  });

  const handoffContext = buildLandingBookingHandoffContext(input.tracking);
  const trackingNotes = [
    handoffContext.intent ? `상담의도: ${handoffContext.intent}` : null,
    handoffContext.budget ? `예산조건: ${handoffContext.budget}` : null,
    handoffContext.destination ? `목적지: ${handoffContext.destination}` : null,
    handoffContext.party_type ? `고객유형: ${handoffContext.party_type}` : null,
    handoffContext.selected_products.length ? `선택상품: ${handoffContext.selected_products.join(', ')}` : null,
    typeof handoffContext.ready_count === 'number' ? `문의준비도: ${handoffContext.ready_count}` : null,
    handoffContext.missing_fields.length ? `보완필드: ${handoffContext.missing_fields.join(', ')}` : null,
    handoffContext.decision_summary ? `판단요약: ${handoffContext.decision_summary}` : null,
    handoffContext.handoff_preview ? `전달미리보기: ${handoffContext.handoff_preview}` : null,
  ].filter(Boolean);

  const notes = [
    ...trackingNotes,
    '[랜딩 예약 요청]',
    '고객이 상품 랜딩에서 예약 문의 후 카카오 채널로 이동했습니다.',
    `희망 출발일: ${input.form.desiredDate || '미정'}`,
    `인원: 성인 ${adultCount}명 / 아동 ${childCount}명`,
    input.leadId ? `lead_id: ${input.leadId}` : null,
    internalCode ? `상품코드: ${internalCode}` : null,
    input.tracking?.landingUrl ? `랜딩URL: ${input.tracking.landingUrl}` : null,
    input.affiliateRef ? `제휴코드: ${input.affiliateRef}` : null,
    '운영 액션: 좌석/가능 여부 확인 후 고객에게 카카오로 안내',
  ].filter(Boolean).join('\n');

  const booking = await createBooking({
    packageId: packageRow.id,
    packageTitle: packageRow.title || '랜딩 예약 요청',
    leadCustomerId: customerId,
    adultCount,
    childCount,
    adultCost,
    adultPrice,
    childCost,
    childPrice,
    fuelSurcharge: 0,
    departureDate: input.form.desiredDate || undefined,
    departureRegion: pickDepartureRegion(packageRow.products),
    landOperator: packageRow.land_operator || undefined,
    bookingDate: new Date().toISOString().slice(0, 10),
    notes,
    status: 'pending',
    paidAmount: 0,
    ...(affiliateCommission
      ? {
          affiliateId: affiliateCommission.affiliateId,
          bookingType: 'AFFILIATE',
          influencerCommission: affiliateCommission.influencerCommission,
          appliedTotalCommissionRate: affiliateCommission.appliedTotalCommissionRate,
          commissionBreakdown: affiliateCommission.commissionBreakdown,
        }
      : {}),
    idempotencyKey,
    conversationId: input.chatSessionId || undefined,
    depositNoticeBlocked: true,
    utm_source: input.affiliateRef || input.tracking?.utmSource || input.channel || null,
    utm_medium: input.tracking?.utmMedium || null,
    utm_campaign: input.tracking?.utmCampaign || null,
    utm_term: input.tracking?.utmTerm || null,
    utm_content: input.tracking?.utmContent || null,
    referral_code: input.affiliateRef || null,
    attribution_model: input.affiliateRef ? 'last_touch' : null,
    attribution_split: input.affiliateRef
      ? {
          model: 'last_touch',
          last_touch: input.affiliateRef,
          source: 'landing_lead',
        }
      : null,
    attribution_snapshot: input.affiliateRef
      ? {
          source: 'landing_lead',
          captured_at: new Date().toISOString(),
          affiliate_id: affiliateCommission?.affiliateId ?? null,
          referral_code: input.affiliateRef,
          utm_source: input.affiliateRef || input.tracking?.utmSource || null,
          utm_medium: input.tracking?.utmMedium || null,
          utm_campaign: input.tracking?.utmCampaign || null,
          utm_term: input.tracking?.utmTerm || null,
          utm_content: input.tracking?.utmContent || null,
        }
      : null,
  });

  if (booking?.id) {
    await enqueueSeatCheckRequiredTask(booking.id as string, {
      lead_id: input.leadId ?? null,
      desired_date: input.form.desiredDate || null,
      total_people: totalPeople,
      source: input.channel ?? 'landing',
      product_id: packageRow.id,
      package_title: packageRow.title ?? null,
      handoff_context: handoffContext,
      intent: handoffContext.intent,
      budget: handoffContext.budget,
      destination: handoffContext.destination,
      party_type: handoffContext.party_type,
      selected_products: handoffContext.selected_products,
      ready_count: handoffContext.ready_count,
      missing_fields: handoffContext.missing_fields,
      decision_summary: handoffContext.decision_summary,
      handoff_preview: handoffContext.handoff_preview,
      next_manual_step: '좌석/가능 여부 확인 후 고객에게 카카오로 안내',
    });

    dispatchPushAsync({
      title: '신규 예약 요청',
      body: `${booking.booking_no ?? ''} · ${input.form.name} · ${packageRow.title ?? ''}`.trim(),
      deepLink: `/m/admin/bookings/${booking.id}`,
      kind: 'new_booking',
      tag: `booking-${booking.id}`,
    });
  }

  return { booking, customerId, idempotentReplay: false };
}
