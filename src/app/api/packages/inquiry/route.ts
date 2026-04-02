import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

// POST /api/packages/inquiry — view_count 또는 inquiry_count 증가
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: true }); // 설정 안 돼도 200
  }

  try {
    const { packageId, type } = await request.json();

    if (!packageId) {
      return NextResponse.json({ error: 'packageId 필요' }, { status: 400 });
    }

    if (type === 'inquiry') {
      await supabaseAdmin.rpc('increment_package_inquiry_count', {
        package_id: packageId,
      });
    } else {
      // 기본: view_count 증가
      await supabaseAdmin.rpc('increment_package_view_count', {
        package_id: packageId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('카운트 증가 오류:', error);
    // 추적 실패해도 200 반환 (사용자 경험 방해 X)
    return NextResponse.json({ success: true });
  }
}
