import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('kakao_inbound')
      .select('*')
      .eq('is_processed', false)
      .order('received_at', { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ messages: data, count: data?.length || 0 })
  } catch {
    // 테이블이 아직 없는 경우 등
    return NextResponse.json({ messages: [], count: 0 })
  }
}
