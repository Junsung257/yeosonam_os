import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { maskPhone, maskEmail, type AdminRole } from '@/lib/pii-mask';

/**
 * GET /api/admin/customers/masked
 *
 * 현재 사용자의 role에 따라 PII 마스킹을 적용한 고객 목록 반환.
 * - super_admin: 원본 데이터
 * - cs_agent / marketer / finance: 전화번호·이메일 마스킹
 *
 * Auth: Supabase Access Token (쿠키 sb-access-token 또는 Authorization 헤더)
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ data: [], role: 'cs_agent' });
  }

  try {
    // ── 1. 현재 사용자 ID 추출 (JWT 토큰에서) ──────────────────
    const token =
      request.cookies.get('sb-access-token')?.value ??
      request.headers.get('Authorization')?.replace('Bearer ', '');

    let userId: string | null = null;
    if (token) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json({ error: '인증 필요' }, { status: 401 });
    }

    // ── 2. admin_users에서 role 조회 ───────────────────────────
    let role: AdminRole = 'cs_agent'; // 기본값 (role 판단 불가 시)

    if (userId) {
      const { data: adminRow } = await supabaseAdmin
        .from('admin_users')
        .select('role')
        .eq('user_id', userId)
        .limit(1);

      const rawRole = adminRow?.[0]?.role as string | undefined;
      if (
        rawRole &&
        ['super_admin', 'cs_agent', 'marketer', 'finance'].includes(rawRole)
      ) {
        role = rawRole as AdminRole;
      }
    }

    // ── 3. 고객 목록 조회 ──────────────────────────────────────
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')));
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') ?? '';

    let query = supabaseAdmin
      .from('customers')
      .select('id, name, email, phone, grade, total_spent, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    // ── 4. 역할에 따라 PII 마스킹 적용 ───────────────────────
    type CustomerRow = {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      grade: string | null;
      total_spent: number | null;
      created_at: string | null;
    };
    const maskedData = (data ?? [] as CustomerRow[]).map((c: CustomerRow) => ({
      ...c,
      phone: maskPhone(c.phone, role),
      email: maskEmail(c.email, role),
    }));

    return NextResponse.json({
      data: maskedData,
      count,
      role,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
