import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { executeAction } from '@/lib/agent-action-executor'
import { isValidTransition } from '@/lib/agent-action-machine'
import { fetchBlogSearchMetrics, extractSlugFromUrl, isGSCConfigured } from '@/lib/gsc-client'
import {
  publishCarouselToInstagram,
  isInstagramConfigured,
  getInstagramConfig,
  checkPublishingLimit,
} from '@/lib/instagram-publisher'

export async function GET(request: NextRequest) {
  const startAt = Date.now()
  const log: string[] = []
  const push = (msg: string) => { console.log('[agent-executor]', msg); log.push(msg) }

  push('=== 에이전트 액션 실행기 시작 ===')

  // 인증: CRON_SECRET 또는 force=true
  const isForce = request.nextUrl.searchParams.get('force') === 'true'
  if (!isForce) {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!isSupabaseConfigured) {
    push('Supabase 미설정 — 스킵')
    return NextResponse.json({ ok: true, skipped: true, log })
  }

  const processed = { executed: 0, failed: 0, expired: 0, errors: [] as string[] }

  // ── 1. approved 액션 실행 ─────────────────────────────────────────
  try {
    const { data: approvedActions, error } = await supabaseAdmin
      .from('agent_actions')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .limit(10)

    if (error) throw error

    for (const action of approvedActions ?? []) {
      try {
        push(`실행: [${action.agent_type}] ${action.action_type} (${action.id.slice(0, 8)})`)
        const result = await executeAction(action.action_type, action.payload)

        const newStatus = result.success ? 'executed' : 'failed'
        if (!isValidTransition('approved', newStatus)) {
          push(`전이 불가: approved → ${newStatus}`)
          continue
        }

        await supabaseAdmin
          .from('agent_actions')
          .update({
            status: newStatus,
            result_log: result.success
              ? JSON.stringify(result.data)
              : result.error,
            resolved_at: new Date().toISOString(),
          })
          .eq('id', action.id)

        if (result.success) {
          processed.executed++
          push(`  ✓ 성공`)
        } else {
          processed.failed++
          push(`  ✗ 실패: ${result.error}`)
          processed.errors.push(`${action.action_type} (${action.id.slice(0, 8)}): ${result.error}`)
        }
      } catch (e) {
        processed.failed++
        const errMsg = e instanceof Error ? e.message : String(e)
        push(`  ✗ 예외: ${errMsg}`)
        processed.errors.push(`${action.action_type} (${action.id.slice(0, 8)}): ${errMsg}`)

        await supabaseAdmin
          .from('agent_actions')
          .update({
            status: 'failed',
            result_log: errMsg,
            resolved_at: new Date().toISOString(),
          })
          .eq('id', action.id)
      }
    }
  } catch (e) {
    push(`approved 조회 실패: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 2. 만료 처리: pending + expires_at < now → expired ────────────
  try {
    const now = new Date().toISOString()
    const { data: expiredActions, error } = await supabaseAdmin
      .from('agent_actions')
      .select('id')
      .eq('status', 'pending')
      .not('expires_at', 'is', null)
      .lt('expires_at', now)
      .limit(50)

    if (error) throw error

    if (expiredActions && expiredActions.length > 0) {
      const ids = expiredActions.map((a: any) => a.id)
      await supabaseAdmin
        .from('agent_actions')
        .update({ status: 'expired', resolved_at: now })
        .in('id', ids)

      processed.expired = ids.length
      push(`만료 처리: ${ids.length}건`)
    }
  } catch (e) {
    push(`만료 처리 실패: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 3. Google Search Console 데이터 수집 ────────────────────────────
  const gscStats = { pages_processed: 0, rows_inserted: 0, skipped: false as boolean | string }
  try {
    if (!isGSCConfigured()) {
      gscStats.skipped = 'GOOGLE_SERVICE_ACCOUNT_JSON 미설정'
      push('GSC 수집 스킵 — 환경변수 미설정')
    } else {
      const siteUrl = process.env.GSC_SITE_URL || 'sc-domain:yeosonam.com'
      // GSC는 최소 2일 지연 데이터 제공 → 3일 전 데이터 수집
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() - 3)
      const dateStr = targetDate.toISOString().slice(0, 10)

      push(`GSC 수집 시작: ${siteUrl}, ${dateStr}`)
      const metrics = await fetchBlogSearchMetrics(siteUrl, dateStr, true)
      push(`  가져온 행: ${metrics.length}`)

      // URL → slug → content_creative_id 매핑
      const slugToMetrics = new Map<string, { impressions: number; clicks: number; position: number; topQuery: string; topImpressions: number }>()
      for (const m of metrics) {
        const slug = extractSlugFromUrl(m.page)
        if (!slug) continue
        const existing = slugToMetrics.get(slug)
        if (!existing) {
          slugToMetrics.set(slug, {
            impressions: m.impressions,
            clicks: m.clicks,
            position: m.position * m.impressions,  // 가중 평균용
            topQuery: m.query || '',
            topImpressions: m.impressions,
          })
        } else {
          existing.impressions += m.impressions
          existing.clicks += m.clicks
          existing.position += m.position * m.impressions
          if (m.impressions > existing.topImpressions) {
            existing.topQuery = m.query || existing.topQuery
            existing.topImpressions = m.impressions
          }
        }
      }

      if (slugToMetrics.size > 0) {
        const slugs = Array.from(slugToMetrics.keys())
        const { data: creatives } = await supabaseAdmin
          .from('content_creatives')
          .select('id, slug')
          .in('slug', slugs)
          .eq('channel', 'naver_blog')

        for (const cc of (creatives ?? []) as { id: string; slug: string }[]) {
          const m = slugToMetrics.get(cc.slug)
          if (!m) continue
          const avgPosition = m.impressions > 0 ? m.position / m.impressions : 0
          const ctr = m.impressions > 0 ? m.clicks / m.impressions : 0

          await supabaseAdmin
            .from('blog_search_metrics')
            .upsert({
              content_creative_id: cc.id,
              date: dateStr,
              impressions: m.impressions,
              clicks: m.clicks,
              ctr: Number(ctr.toFixed(4)),
              avg_position: Number(avgPosition.toFixed(2)),
              top_query: m.topQuery || null,
            }, { onConflict: 'content_creative_id,date' })
          gscStats.rows_inserted++
        }
        gscStats.pages_processed = creatives?.length ?? 0
      }
      push(`  매칭된 블로그: ${gscStats.pages_processed}, 저장: ${gscStats.rows_inserted}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    push(`GSC 수집 오류: ${msg}`)
  }

  // ── 4. 인스타그램 예약 발행 처리 ────────────────────────────────────
  const igStats = { published: 0, failed: 0, skipped: 0, quota_reason: null as string | null }
  try {
    if (!isInstagramConfigured()) {
      push('IG 예약 스킵 — META_ACCESS_TOKEN 또는 META_IG_USER_ID 미설정')
      igStats.quota_reason = 'not_configured'
    } else {
      const cfg = await getInstagramConfig()
      if (!cfg) {
        push('IG 예약 스킵 — 토큰 해석 실패 (env+DB)')
        igStats.quota_reason = 'token_unresolved'
      } else {
      const quota = await checkPublishingLimit(cfg.igUserId, cfg.accessToken)
      if (quota && quota.quotaUsed >= quota.quotaLimit - 5) {
        push(`IG 예약 스킵 — quota ${quota.quotaUsed}/${quota.quotaLimit} (5건 미만 잔여)`)
        igStats.quota_reason = `quota_used_${quota.quotaUsed}_of_${quota.quotaLimit}`
      } else {
        const nowIso = new Date().toISOString()
        const { data: dueItems, error: dueErr } = await supabaseAdmin
          .from('card_news')
          .select('id, ig_caption, ig_slide_urls, ig_scheduled_for')
          .eq('ig_publish_status', 'queued')
          .lte('ig_scheduled_for', nowIso)
          .limit(20)
        if (dueErr) throw dueErr

        push(`IG 예약 조회: ${dueItems?.length ?? 0}건`)

        for (const item of dueItems ?? []) {
          const urls = Array.isArray(item.ig_slide_urls) ? item.ig_slide_urls as string[] : []
          if (urls.length < 2 || urls.length > 10) {
            await supabaseAdmin
              .from('card_news')
              .update({ ig_publish_status: 'failed', ig_error: `이미지 ${urls.length}장 (2~10 필요)` })
              .eq('id', item.id)
            igStats.failed++
            push(`  ✗ ${item.id.slice(0, 8)} 이미지 수 불일치`)
            continue
          }
          // publishing 마킹
          await supabaseAdmin
            .from('card_news')
            .update({ ig_publish_status: 'publishing', ig_error: null })
            .eq('id', item.id)

          const result = await publishCarouselToInstagram({
            igUserId: cfg.igUserId,
            accessToken: cfg.accessToken,
            imageUrls: urls,
            caption: item.ig_caption || '',
          })

          if (result.ok) {
            await supabaseAdmin
              .from('card_news')
              .update({
                ig_publish_status: 'published',
                ig_post_id: result.postId,
                ig_published_at: new Date().toISOString(),
                ig_error: null,
              })
              .eq('id', item.id)
            igStats.published++
            push(`  ✓ ${item.id.slice(0, 8)} → ${result.postId}`)
          } else {
            await supabaseAdmin
              .from('card_news')
              .update({
                ig_publish_status: 'failed',
                ig_error: `[${result.step}] ${result.error}`,
              })
              .eq('id', item.id)
            igStats.failed++
            push(`  ✗ ${item.id.slice(0, 8)} ${result.step}: ${result.error}`)
          }
        }
      }
      } // close else (cfg ok)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    push(`IG 예약 처리 오류: ${msg}`)
  }

  push(`=== 완료 (${Date.now() - startAt}ms) ===`)

  return NextResponse.json({
    ok: true,
    is_force: isForce,
    elapsed_ms: Date.now() - startAt,
    processed,
    gsc: gscStats,
    ig: igStats,
    log,
  })
}
