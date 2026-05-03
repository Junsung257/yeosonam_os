import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { verifyAffiliateReferralAndPin } from '@/lib/influencer-pin-auth';

const DEFAULT_BEST = [
  {
    title: '릴스 첫 3초 훅을 가격 비교로 시작',
    channel: 'instagram_reels',
    summary: '"일반가 80만원 vs 팬가 75만원" 형태로 시작하면 클릭률이 높습니다.',
    tags: ['price-contrast', 'hook'],
  },
  {
    title: '스토리 3장 구조로 링크 전환 유도',
    channel: 'instagram_story',
    summary: '문제 제기 → 해결책(상품) → CTA 링크 순서가 전환에 유리합니다.',
    tags: ['storytelling', 'cta'],
  },
];

const DEFAULT_CS = [
  {
    category: 'refund',
    title: '환불 문의 대응',
    script: '문의 주셔서 감사합니다. 환불/변경은 여소남 고객센터가 가장 빠르게 처리합니다. 아래 공식 채널로 접수 부탁드립니다.',
  },
  {
    category: 'claim',
    title: '악플/클레임 대응',
    script: '개별 DM로 확인이 어려워 공식 CS팀으로 전달 부탁드립니다. 예약번호와 함께 접수해 주시면 정확히 확인해드립니다.',
  },
];

function readPin(req: NextRequest): string | undefined {
  return req.headers.get('x-influencer-pin')?.trim() || undefined;
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ best_practices: DEFAULT_BEST, cs_scripts: DEFAULT_CS });
  }
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'code 필요' }, { status: 400 });

  const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, code, readPin(req));
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { data: best } = await supabaseAdmin
    .from('affiliate_best_practices')
    .select('id, title, channel, summary, example_url, tags')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: scripts } = await supabaseAdmin
    .from('affiliate_cs_scripts')
    .select('id, category, title, script')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({
    best_practices: best?.length ? best : DEFAULT_BEST,
    cs_scripts: scripts?.length ? scripts : DEFAULT_CS,
  });
}

