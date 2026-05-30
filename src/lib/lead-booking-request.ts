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

type PackageRow = {
  id: string;
  title: string | null;
  price: number | null;
  cost_price: number | null;
  price_dates?: unknown;
  price_list?: unknown;
  price_tiers?: unknown;
  destination: string | null;
  land_operator: string | null;
  land_operator_id: string | null;
  products?: { internal_code?: string | null; departure_region?: string | null } | Array<{ internal_code?: string | null; departure_region?: string | null }> | null;
};

function digitsOnly(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

function makeIdempotencyKey(input: CreateLandingBookingRequestInput): string {
  const raw = [
    'landing-booking',
    input.productId,
    input.form.desiredDate,
    input.form.adults,
    input.form.children,
    digitsOnly(input.form.phone),
  ].join('|');
  return `lp:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 48)}`;
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

export async function createLandingBookingRequest(input: CreateLandingBookingRequestInput) {
  if (!input.productId) throw new Error('productId is required');
  if (!input.form?.name || !input.form?.phone || !input.form?.privacyConsent) {
    throw new Error('required customer fields are missing');
  }

  const idempotencyKey = input.idempotencyKey?.trim() || makeIdempotencyKey(input);
  const { data: existing } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, status, idempotency_key')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { booking: existing, customerId: null, idempotentReplay: true };
  }

  const [{ data: pkg, error: pkgErr }, customerId] = await Promise.all([
    supabaseAdmin
      .from('travel_packages')
      .select(
        'id, title, price, cost_price, price_dates, price_list, price_tiers, destination, land_operator, land_operator_id, products(internal_code, departure_region)',
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

  const notes = [
    '[랜딩 예약 요청]',
    '고객이 상품 랜딩에서 예약 요청 후 카카오 채널로 이동했습니다.',
    `희망 출발일: ${input.form.desiredDate || '미정'}`,
    `인원: 성인 ${adultCount}명 / 아동 ${childCount}명`,
    input.leadId ? `lead_id: ${input.leadId}` : null,
    internalCode ? `상품코드: ${internalCode}` : null,
    input.tracking?.landingUrl ? `랜딩URL: ${input.tracking.landingUrl}` : null,
    input.affiliateRef ? `제휴코드: ${input.affiliateRef}` : null,
    '운영자 액션: 랜드사 좌석 가능 여부 확인 후 고객에게 카카오로 안내',
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
    idempotencyKey,
    conversationId: input.chatSessionId || undefined,
    depositNoticeBlocked: true,
    utm_source: input.affiliateRef || input.tracking?.utmSource || input.channel || null,
    utm_medium: input.tracking?.utmMedium || null,
    utm_campaign: input.tracking?.utmCampaign || null,
    utm_term: input.tracking?.utmTerm || null,
    utm_content: input.tracking?.utmContent || null,
    referral_code: input.affiliateRef || null,
  });

  if (booking?.id) {
    await enqueueSeatCheckRequiredTask(booking.id as string, {
      lead_id: input.leadId ?? null,
      desired_date: input.form.desiredDate || null,
      total_people: totalPeople,
      source: input.channel ?? 'landing',
      next_manual_step: '랜드사 좌석 가능 여부 확인',
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
