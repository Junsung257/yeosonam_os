/**
 * 여소남 OS — RAG 전수 재인덱싱 오케스트레이터 (Phase 4 §B.3.3)
 *
 * 사용법:
 *   node db/rag_reindex_all.js --source=packages    # 패키지만
 *   node db/rag_reindex_all.js --source=blogs
 *   node db/rag_reindex_all.js --source=attractions
 *   node db/rag_reindex_all.js                      # 전체
 *   node db/rag_reindex_all.js --tenant=<uuid>      # 특정 테넌트만
 *   node db/rag_reindex_all.js --dry-run            # 실제 INSERT 안 함
 *
 * 비용 제어:
 *   - 청크 1개당: Flash contextualize 1회 + embedding 1회 ≈ $0.0005~0.001
 *   - 1000 청크 ≈ $0.5~1
 *   - --limit N 으로 개수 제한 가능
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { contextualizeChunk, chunkText, embedDocument, hashContent } = require('./rag_contextualize')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_AI_API_KEY) {
  console.error('환경변수 필수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_AI_API_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

function parseArgs() {
  const args = process.argv.slice(2)
  const opt = { source: 'all', tenant: null, dryRun: false, limit: null }
  for (const a of args) {
    if (a.startsWith('--source=')) opt.source = a.slice(9)
    else if (a.startsWith('--tenant=')) opt.tenant = a.slice(9)
    else if (a === '--dry-run') opt.dryRun = true
    else if (a.startsWith('--limit=')) opt.limit = parseInt(a.slice(8), 10)
  }
  return opt
}

// ─── 소스별 어댑터 ────────────────────────────────────────────────────
const adapters = {
  async packages(opt) {
    let q = sb.from('travel_packages')
      .select('id, tenant_id, title, destination, product_summary, highlights_md, itinerary_data, created_at')
      .order('updated_at', { ascending: false })
    if (opt.tenant) q = q.eq('tenant_id', opt.tenant)
    if (opt.limit) q = q.limit(opt.limit)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []).map(p => ({
      tenantId: p.tenant_id ?? null,
      sourceType: 'package',
      sourceId: p.id,
      sourceUrl: `/packages/${p.id}`,
      sourceTitle: p.title,
      docSummary: `${p.destination ?? ''} · ${(p.product_summary ?? '').slice(0, 300)}`,
      body: [
        p.product_summary ?? '',
        p.highlights_md ?? '',
        flattenItinerary(p.itinerary_data),
      ].filter(Boolean).join('\n\n'),
    }))
  },

  async blogs(opt) {
    // v4 fix (2026-04-30): blog_posts 테이블 없음. content_creatives 사용
    let q = sb.from('content_creatives')
      .select('id, tenant_id, slug, seo_title, seo_description, blog_html, ad_copy, created_at')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('created_at', { ascending: false })
    if (opt.tenant) q = q.eq('tenant_id', opt.tenant)
    if (opt.limit) q = q.limit(opt.limit)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []).map(b => {
      // blog_html에서 태그 제거 (간단한 strip)
      const stripped = (b.blog_html ?? b.ad_copy ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        tenantId: b.tenant_id ?? null,
        sourceType: 'blog',
        sourceId: b.id,
        sourceUrl: `/blog/${b.slug}`,
        sourceTitle: b.seo_title ?? '여행 가이드',
        docSummary: b.seo_description ?? b.seo_title ?? '',
        body: stripped,
      };
    })
  },

  async attractions(opt) {
    // v4 fix (2026-04-30): destination 컬럼 없음 → country + region 사용
    let q = sb.from('attractions')
      .select('id, name, country, region, long_desc, short_desc, created_at')
      .or('long_desc.not.is.null,short_desc.not.is.null')
    if (opt.limit) q = q.limit(opt.limit)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []).map(a => ({
      tenantId: null, // attractions 는 공유 카탈로그
      sourceType: 'attraction',
      sourceId: a.id,
      sourceUrl: null,
      sourceTitle: a.name,
      docSummary: `${[a.country, a.region].filter(Boolean).join(' · ')} · ${a.short_desc ?? ''}`.slice(0, 300),
      body: [a.long_desc, a.short_desc].filter(Boolean).join('\n\n'),
    }))
  },
}

function flattenItinerary(itin) {
  if (!itin) return ''
  try {
    const days = Array.isArray(itin) ? itin : itin.days
    if (!Array.isArray(days)) return ''
    return days.map((d, i) => {
      const items = (d.items ?? []).map(it => it.activity ?? it.name ?? '').filter(Boolean).join(', ')
      return `Day ${i + 1}: ${items}`
    }).join('\n')
  } catch {
    return ''
  }
}

// ─── 메인 파이프라인 ──────────────────────────────────────────────────
async function indexDocument(doc, opt) {
  const chunks = chunkText(doc.body, 1200)
  if (chunks.length === 0) return { inserted: 0, skipped: 1 }

  let inserted = 0
  let skipped = 0

  for (let idx = 0; idx < chunks.length; idx++) {
    const rawChunk = chunks[idx]
    const contentHash = hashContent(rawChunk)

    // dedupe — 같은 source+chunk_index+hash 이미 있으면 스킵
    if (!opt.dryRun) {
      const { data: existing } = await sb
        .from('jarvis_knowledge_chunks')
        .select('id, content_hash')
        .eq('source_type', doc.sourceType)
        .eq('source_id', doc.sourceId)
        .eq('chunk_index', idx)
        .maybeSingle()
      if (existing && existing.content_hash === contentHash) {
        skipped++
        continue
      }
    }

    const contextualText = await contextualizeChunk({
      docTitle: doc.sourceTitle,
      docSummary: doc.docSummary,
      chunk: rawChunk,
      apiKey: GOOGLE_AI_API_KEY,
    })

    const embedding = await embedDocument(contextualText, GOOGLE_AI_API_KEY)
    if (!embedding) {
      console.warn(`  - embedding 실패: ${doc.sourceType}/${doc.sourceId}#${idx}`)
      continue
    }

    if (opt.dryRun) {
      console.log(`  [dry] ${doc.sourceType}/${doc.sourceId}#${idx} (${contextualText.length} chars)`)
      inserted++
      continue
    }

    const { error } = await sb
      .from('jarvis_knowledge_chunks')
      .upsert({
        tenant_id: doc.tenantId,
        source_type: doc.sourceType,
        source_id: doc.sourceId,
        source_url: doc.sourceUrl,
        source_title: doc.sourceTitle,
        chunk_index: idx,
        chunk_text: rawChunk,
        contextual_text: contextualText,
        embedding,
        content_hash: contentHash,
        metadata: {},
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,source_type,source_id,chunk_index' })

    if (error) {
      console.error(`  ✗ upsert 실패 ${doc.sourceType}/${doc.sourceId}#${idx}:`, error.message)
      continue
    }

    inserted++

    // Rate limit 보호 — Gemini Flash QPS 제한 대비 300ms sleep
    await new Promise(r => setTimeout(r, 300))
  }

  return { inserted, skipped }
}

async function main() {
  const opt = parseArgs()
  console.log('─── RAG 재인덱싱 시작 ───')
  console.log('옵션:', opt)

  const sources = opt.source === 'all'
    ? ['packages', 'blogs', 'attractions']
    : [opt.source]

  let totalInserted = 0
  let totalSkipped = 0
  let totalDocs = 0

  for (const source of sources) {
    const adapter = adapters[source]
    if (!adapter) {
      console.warn(`알 수 없는 source: ${source}`)
      continue
    }

    console.log(`\n[${source}] 문서 조회 중...`)
    const docs = await adapter(opt)
    console.log(`  ${docs.length}건`)
    totalDocs += docs.length

    for (const doc of docs) {
      const { inserted, skipped } = await indexDocument(doc, opt)
      totalInserted += inserted
      totalSkipped += skipped
      if (inserted > 0) {
        console.log(`  ✓ ${doc.sourceType}/${doc.sourceId} — +${inserted} chunks (${skipped} skipped)`)
      }
    }
  }

  console.log('\n─── 완료 ───')
  console.log(`문서: ${totalDocs} · 청크 삽입: ${totalInserted} · 스킵: ${totalSkipped}`)
}

main().catch(err => {
  console.error('오류:', err)
  process.exit(1)
})
