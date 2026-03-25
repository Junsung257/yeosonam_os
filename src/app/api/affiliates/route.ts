import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt, maskBankInfo } from '@/lib/encryption';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createClient(supabaseUrl, supabaseKey);
}

const GRADE_LABELS: Record<number, string> = {
  1: '브론즈', 2: '실버', 3: '골드', 4: '플래티넘', 5: '다이아',
};

// GET: 어필리에이트 목록 또는 단건 조회
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const showBankInfo = searchParams.get('showBankInfo') === 'true';

  const supabase = getSupabase();

  try {
    if (id) {
      // 단건 조회
      const { data, error } = await supabase
        .from('affiliates')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!data) return NextResponse.json({ error: '어필리에이트를 찾을 수 없습니다.' }, { status: 404 });

      // 계좌 정보 처리
      let bankInfo = null;
      if (data.encrypted_bank_info) {
        bankInfo = showBankInfo
          ? decrypt(data.encrypted_bank_info)
          : maskBankInfo(decrypt(data.encrypted_bank_info));
      }

      return NextResponse.json({
        affiliate: {
          ...data,
          encrypted_bank_info: undefined,
          bank_info: bankInfo,
          grade_label: GRADE_LABELS[data.grade] || '브론즈',
        },
      });
    }

    // 목록 조회
    const { data, error } = await supabase
      .from('affiliates')
      .select('id, name, phone, email, referral_code, grade, bonus_rate, payout_type, booking_count, total_commission, memo, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      affiliates: (data || []).map(a => ({
        ...a,
        grade_label: GRADE_LABELS[a.grade] || '브론즈',
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// POST: 어필리에이트 신규 등록
export async function POST(request: NextRequest) {
  const supabase = getSupabase();

  try {
    const body = await request.json();
    const { name, phone, email, referral_code, payout_type, bank_info, memo } = body;

    if (!name) return NextResponse.json({ error: '이름은 필수입니다.' }, { status: 400 });
    if (!referral_code) return NextResponse.json({ error: '추천코드는 필수입니다.' }, { status: 400 });

    // 추천코드 중복 확인
    const { data: existing } = await supabase
      .from('affiliates')
      .select('id')
      .eq('referral_code', referral_code)
      .single();

    if (existing) return NextResponse.json({ error: '이미 사용 중인 추천코드입니다.' }, { status: 400 });

    // 계좌 암호화
    const encrypted_bank_info = bank_info ? encrypt(bank_info) : null;

    const { data, error } = await supabase
      .from('affiliates')
      .insert([{
        name,
        phone: phone || null,
        email: email || null,
        referral_code,
        payout_type: payout_type || 'PERSONAL',
        encrypted_bank_info,
        memo: memo || null,
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      affiliate: {
        ...data,
        encrypted_bank_info: undefined,
        grade_label: GRADE_LABELS[data.grade] || '브론즈',
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '등록 실패' }, { status: 500 });
  }
}

// PATCH: 어필리에이트 정보 수정
export async function PATCH(request: NextRequest) {
  const supabase = getSupabase();

  try {
    const body = await request.json();
    const { id, name, phone, email, payout_type, bank_info, memo, booking_count } = body;

    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) payload.name = name;
    if (phone !== undefined) payload.phone = phone;
    if (email !== undefined) payload.email = email;
    if (payout_type !== undefined) payload.payout_type = payout_type;
    if (memo !== undefined) payload.memo = memo;
    if (bank_info !== undefined) payload.encrypted_bank_info = bank_info ? encrypt(bank_info) : null;
    if (booking_count !== undefined) payload.booking_count = booking_count; // 트리거로 grade 자동 갱신

    const { data, error } = await supabase
      .from('affiliates')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      affiliate: {
        ...data,
        encrypted_bank_info: undefined,
        grade_label: GRADE_LABELS[data.grade] || '브론즈',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '수정 실패' }, { status: 500 });
  }
}
