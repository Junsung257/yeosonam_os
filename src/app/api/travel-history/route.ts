import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { cacheHeader } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) {
    // mock data
    return NextResponse.json({
      histories: [
        {
          id: 'mock-1',
          destination: '일본 오사카',
          destination_country: '일본',
          departure_date: '2025-12-10',
          duration_nights: 4,
          trip_type: '가족여행',
          tenant_name: 'JTB Japan',
          proposal_title: '오사카 가족 자유여행 4박',
          total_price: 4200000,
          total_pax: 4,
          stamp_image_url: null,
          review_submitted: true,
        },
        {
          id: 'mock-2',
          destination: '베트남 다낭',
          destination_country: '베트남',
          departure_date: '2025-08-20',
          duration_nights: 3,
          trip_type: '친구·모임',
          tenant_name: 'Viet Travel Co.',
          proposal_title: '다낭 골프+관광 3박',
          total_price: 2800000,
          total_pax: 8,
          stamp_image_url: null,
          review_submitted: false,
        },
      ],
    }, { headers: cacheHeader(120) });
  }

  // 실제 구현: auth.uid()로 customers.id를 먼저 조회한 후 travel history 조회
  // (customers 테이블의 id와 auth.users의 id가 다르므로)
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ histories: [] }, { headers: cacheHeader(120) });
    }

    // auth user의 phone 기준으로 customers 테이블 조회
    const phone = user.phone ?? user.email ?? null;
    let customerId: string | null = null;

    if (phone) {
      const digits = phone.replace(/\D/g, '');
      const dbPhone = digits.length === 11
        ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
        : phone;
      const { data: customer } = await sb
        .from('customers')
        .select('id')
        .eq('phone', dbPhone)
        .limit(1);
      customerId = ((customer as unknown as Array<Record<string, unknown>>)?.[0]?.id as string) ?? null;
    }

    // phone으로 찾을 수 없으면 customers.email로 fallback 조회
    if (!customerId && user.email) {
      const { data: customerByEmail } = await sb
        .from('customers')
        .select('id')
        .eq('email', user.email)
        .limit(1);
      customerId = ((customerByEmail as unknown as Array<Record<string, unknown>>)?.[0]?.id as string) ?? null;
    }

    if (!customerId) {
      return NextResponse.json({ histories: [] }, { headers: cacheHeader(120) });
    }

    const { data } = await sb
      .from('user_travel_histories')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    return NextResponse.json({ histories: data ?? [] }, { headers: cacheHeader(120) });
  } catch {
    return NextResponse.json({ histories: [] }, { headers: cacheHeader(120) });
  }
}
