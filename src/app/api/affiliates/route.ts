import { NextRequest, NextResponse } from 'next/server';
import { encrypt, decrypt, maskBankInfo } from '@/lib/encryption';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

const GRADE_LABELS: Record<number, string> = {
  1: '브론즈', 2: '실버', 3: '골드', 4: '플래티넘', 5: '다이아',
};

// GET: 어필리에이트 목록 또는 단건 조회
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const showBankInfo = searchParams.get('showBankInfo') === 'true';

  const supabase = supabaseAdmin;

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
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    type Row = { grade?: number | null } & Record<string, unknown>;
    return NextResponse.json({
      affiliates: ((data ?? []) as Row[]).map((a) => {
        const g = a.grade;
        const gradeLabel =
          typeof g === 'number' && g >= 1 && g <= 5 ? GRADE_LABELS[g] : undefined;
        return { ...a, grade_label: gradeLabel || '브론즈' };
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// POST: 어필리에이트 신규 등록
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const supabase = supabaseAdmin;

  try {
    const body = await request.json();
    const { name, phone, email, referral_code, payout_type, bank_info, memo } = body;

    if (!name) return NextResponse.json({ error: '이름은 필수입니다.' }, { status: 400 });
    if (!referral_code) return NextResponse.json({ error: '추천코드는 필수입니다.' }, { status: 400 });

    const referralCanon = normalizeAffiliateReferralCode(referral_code);
    if (!referralCanon) return NextResponse.json({ error: '추천코드가 비어 있습니다.' }, { status: 400 });

    // 추천코드 중복 확인
    const { data: existing } = await supabase
      .from('affiliates')
      .select('id')
      .eq('referral_code', referralCanon)
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
        referral_code: referralCanon,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeLandingPickIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string' || !UUID_RE.test(x)) continue;
    if (!out.includes(x)) out.push(x);
    if (out.length >= 12) break;
  }
  return out;
}

function sanitizeLandingVideoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > 500) return null;
  const ok =
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/.test(t) ||
    /^https?:\/\/youtu\.be\/[a-zA-Z0-9_-]{11}/.test(t) ||
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]{11}/.test(t);
  return ok ? t : null;
}

// PATCH: 어필리에이트 정보 수정
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const supabase = supabaseAdmin;

  try {
    const body = await request.json();
    const {
      id,
      name,
      phone,
      email,
      payout_type,
      bank_info,
      memo,
      booking_count,
      commission_rate,
      business_number,
      is_active,
      landing_intro,
      landing_pick_package_ids,
      landing_video_url,
    } = body;

    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) payload.name = name;
    if (phone !== undefined) payload.phone = phone;
    if (email !== undefined) payload.email = email;
    if (payout_type !== undefined) payload.payout_type = payout_type;
    if (memo !== undefined) payload.memo = memo;
    if (bank_info !== undefined) payload.encrypted_bank_info = bank_info ? encrypt(bank_info) : null;
    if (booking_count !== undefined) payload.booking_count = booking_count; // 트리거로 grade 자동 갱신
    if (commission_rate !== undefined) {
      const n = Number(commission_rate);
      if (Number.isFinite(n) && n >= 0 && n <= 0.5) payload.commission_rate = n;
    }
    if (business_number !== undefined) payload.business_number = business_number || null;
    if (is_active !== undefined) payload.is_active = !!is_active;
    if (landing_intro !== undefined) {
      const t = typeof landing_intro === 'string' ? landing_intro.trim() : '';
      payload.landing_intro = t.length > 0 ? t.slice(0, 4000) : null;
    }
    if (landing_pick_package_ids !== undefined) {
      payload.landing_pick_package_ids = sanitizeLandingPickIds(landing_pick_package_ids);
    }
    if (landing_video_url !== undefined) {
      payload.landing_video_url = sanitizeLandingVideoUrl(landing_video_url);
    }

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
