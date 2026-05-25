/**
 * GET /api/content-calendar?year=2026&month=5
 *
 * 통합 콘텐츠 캘린더 API — v2
 * - card_news + content_distributions 통합
 * - 각 콘텐츠의 발행 상태(IG/Threads/X/blog) 상세 표시
 * - 드래그 리스케줄 지원을 위한 scheduled_for 필드
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

interface CalendarItem {
  id: string;
  source: 'card_news' | 'distribution';
  title: string;
  status: string;
  type: 'affiliate' | 'platform';
  branding_level: string | null;
  platform_statuses: Record<string, string | null>;  // e.g. { instagram: 'published', threads: 'queued', x: null }
  scheduled_for: string | null;
  scheduled_platform: string | null;
  created_at: string;
}

interface CalendarDay {
  date: string;
  total: number;
  draft: number;
  confirmed: number;
  published: number;
  archived: number;
  scheduled: number;
  affiliate: number;
  platform: number;
  items: CalendarItem[];
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const year = parseInt(request.nextUrl.searchParams.get('year') ?? String(new Date().getFullYear()), 10);
  const month = parseInt(request.nextUrl.searchParams.get('month') ?? String(new Date().getMonth() + 1), 10);
  const platformFilter = request.nextUrl.searchParams.get('platform'); // optional filter

  const startDate = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

  try {
    // 1. card_news 조회
    let cardNewsQuery = supabaseAdmin
      .from('card_news')
      .select(
        'id, title, status, created_at, ig_scheduled_for, threads_scheduled_for, ig_publish_status, threads_publish_status, template_family, branding_level, created_by_affiliate_id, engagement_score',
      )
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    const { data: cardNews, error: cardErr } = await cardNewsQuery;
    if (cardErr) throw cardErr;

    // 2. content_distributions 조회 (해당 월 scheduled/published 건)
    let distQuery = supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, card_news_id, blog_post_id, platform, status, scheduled_for, published_at, created_at, affiliate_id, error_message')
      .or(
        `scheduled_for.gte.${startDate},scheduled_for.lte.${endDate},published_at.gte.${startDate},published_at.lte.${endDate},created_at.gte.${startDate},created_at.lte.${endDate}`,
      )
      .order('created_at', { ascending: false });

    const { data: distributions, error: distErr } = await distQuery;
    if (distErr) throw distErr;

    // 3. content_distributions 에 연결된 card_news 제목 조회 (Lookup Map)
    const linkedCardNewsIds = [...new Set((distributions ?? []).map((d: { card_news_id?: number }) => d.card_news_id).filter(Boolean))];
    const { data: linkedCards } = await supabaseAdmin
      .from('card_news')
      .select('id, title, branding_level, created_by_affiliate_id')
      .in('id', linkedCardNewsIds);

    const cardTitleMap = new Map<string, { title: string; branding_level: string | null; created_by_affiliate_id: string | null }>();
    for (const c of linkedCards ?? []) {
      cardTitleMap.set(c.id, { title: c.title, branding_level: c.branding_level, created_by_affiliate_id: c.created_by_affiliate_id });
    }

    // 4. 일별 집계
    const byDate = new Map<string, CalendarDay>();

    function getOrCreateDay(dateStr: string): CalendarDay {
      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, {
          date: dateStr,
          total: 0,
          draft: 0,
          confirmed: 0,
          published: 0,
          archived: 0,
          scheduled: 0,
          affiliate: 0,
          platform: 0,
          items: [],
        });
      }
      return byDate.get(dateStr)!;
    }

    // 4a. card_news 항목 처리
    for (const cn of cardNews ?? []) {
      const d = cn.created_at?.slice(0, 10) ?? 'unknown';
      const entry = getOrCreateDay(d);
      entry.total++;

      if (cn.status === 'DRAFT') entry.draft++;
      else if (cn.status === 'CONFIRMED') entry.confirmed++;
      else if (cn.status === 'PUBLISHED' || cn.status === 'LAUNCHED') entry.published++;
      else if (cn.status === 'ARCHIVED') entry.archived++;

      const isAffiliate = !!cn.created_by_affiliate_id;
      if (isAffiliate) entry.affiliate++;
      else entry.platform++;

      // 여러 플랫폼 상태 취합
      const platformStatuses: Record<string, string | null> = {};
      let mainScheduledFor: string | null = null;
      let mainScheduledPlatform: string | null = null;

      if (cn.ig_publish_status) {
        platformStatuses.instagram = cn.ig_publish_status;
        if (cn.ig_scheduled_for) {
          mainScheduledFor = cn.ig_scheduled_for;
          mainScheduledPlatform = 'instagram';
          entry.scheduled++;
        }
      }
      if (cn.threads_publish_status) {
        platformStatuses.threads = cn.threads_publish_status;
        if (cn.threads_scheduled_for && (!mainScheduledFor || cn.threads_scheduled_for < mainScheduledFor)) {
          mainScheduledFor = cn.threads_scheduled_for;
          mainScheduledPlatform = 'threads';
        }
      }

      const item: CalendarItem = {
        id: cn.id,
        source: 'card_news',
        title: cn.title,
        status: cn.status,
        type: isAffiliate ? 'affiliate' : 'platform',
        branding_level: cn.branding_level,
        platform_statuses: platformStatuses,
        scheduled_for: mainScheduledFor,
        scheduled_platform: mainScheduledPlatform,
        created_at: cn.created_at,
      };

      if (!platformFilter || platformStatuses[platformFilter]) {
        entry.items.push(item);
      }
    }

    // 4b. content_distributions 항목 처리 (독립형, card_news에 연결되지 않은 것)
    for (const d of distributions ?? []) {
      // card_news에 연결된 것은 위에서 이미 처리했으므로 스킵
      if (d.card_news_id) continue;

      const dateStr = (d.scheduled_for || d.published_at || d.created_at)?.slice(0, 10) ?? 'unknown';
      const entry = getOrCreateDay(dateStr);

      const title = `[${d.platform}] 배포`;
      const isAffiliate = !!d.affiliate_id;
      const platformStatuses: Record<string, string | null> = {};
      platformStatuses[d.platform] = d.status;

      const item: CalendarItem = {
        id: d.id,
        source: 'distribution',
        title,
        status: d.status,
        type: isAffiliate ? 'affiliate' : 'platform',
        branding_level: null,
        platform_statuses: platformStatuses,
        scheduled_for: d.scheduled_for,
        scheduled_platform: d.platform,
        created_at: d.created_at,
      };

      entry.total++;
      if (d.status === 'published') entry.published++;
      else if (d.status === 'scheduled') entry.scheduled++;
      else if (d.status === 'draft') entry.draft++;
      else if (d.status === 'failed' || d.status === 'archived') entry.archived++;

      if (isAffiliate) entry.affiliate++;
      else entry.platform++;

      if (!platformFilter || platformFilter === d.platform) {
        entry.items.push(item);
      }
    }

    // 5. 예약 목록 (드래그 대상)
    const scheduledItems: Array<{
      id: string;
      source: 'card_news' | 'distribution';
      title: string;
      type: 'affiliate' | 'platform';
      scheduled_for: string;
      platform: string;
      status: string;
      branding_level: string | null;
    }> = [];

    for (const cn of cardNews ?? []) {
      const isAffiliate = !!cn.created_by_affiliate_id;
      if (cn.ig_scheduled_for) {
        scheduledItems.push({
          id: cn.id,
          source: 'card_news',
          title: cn.title,
          type: isAffiliate ? 'affiliate' : 'platform',
          scheduled_for: cn.ig_scheduled_for,
          platform: 'instagram',
          status: cn.ig_publish_status ?? 'scheduled',
          branding_level: cn.branding_level,
        });
      }
      if (cn.threads_scheduled_for) {
        scheduledItems.push({
          id: cn.id,
          source: 'card_news',
          title: cn.title,
          type: isAffiliate ? 'affiliate' : 'platform',
          scheduled_for: cn.threads_scheduled_for,
          platform: 'threads',
          status: cn.threads_publish_status ?? 'scheduled',
          branding_level: cn.branding_level,
        });
      }
    }

    for (const d of distributions ?? []) {
      if (d.scheduled_for && !d.card_news_id) {
        const linked = d.card_news_id ? cardTitleMap.get(d.card_news_id) : null;
        scheduledItems.push({
          id: d.id,
          source: 'distribution',
          title: linked?.title ?? `[${d.platform}] 배포`,
          type: d.affiliate_id ? 'affiliate' : 'platform',
          scheduled_for: d.scheduled_for,
          platform: d.platform,
          status: d.status,
          branding_level: linked?.branding_level ?? null,
        });
      }
    }

    return NextResponse.json({
      year,
      month,
      totalCards: cardNews?.length ?? 0,
      totalDistributions: distributions?.length ?? 0,
      days: [...byDate.entries()]
        .map(([_, v]) => v)
        .sort((a, b) => a.date.localeCompare(b.date)),
      scheduled: scheduledItems.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
