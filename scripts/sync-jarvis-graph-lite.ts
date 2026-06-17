#!/usr/bin/env tsx

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import {
  extractGraphLiteEntities,
  normalizeGraphEntityName,
  type GraphLiteChunk,
} from '@/lib/jarvis/rag/graph-lite'

dotenv.config({ path: '.env.local' })
dotenv.config()

function readNumberArg(args: string[], name: string, fallback: number): number {
  const prefix = `${name}=`
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const value = raw ? Number(raw) : fallback
  return Number.isFinite(value) ? value : fallback
}

function readStringArg(args: string[], name: string): string | null {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null
}

function parseArgs() {
  const args = process.argv.slice(2)
  return {
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
    limit: Math.max(1, Math.floor(readNumberArg(args, '--limit', 2000))),
    sourceType: readStringArg(args, '--source'),
  }
}

function batch<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

async function loadChunks(
  supabase: any,
  options: { limit: number; sourceType: string | null },
): Promise<GraphLiteChunk[]> {
  const chunks: GraphLiteChunk[] = []
  const pageSize = 500

  while (chunks.length < options.limit) {
    const from = chunks.length
    const to = Math.min(options.limit, from + pageSize) - 1
    let query = supabase
      .from('jarvis_knowledge_chunks')
      .select('id, tenant_id, source_type, source_id, source_title, chunk_text, contextual_text')
      .order('updated_at', { ascending: false })
      .range(from, to)

    if (options.sourceType) query = query.eq('source_type', options.sourceType)

    const { data, error } = await query
    if (error) throw error
    const page = (data ?? []) as GraphLiteChunk[]
    chunks.push(...page)
    if (page.length < pageSize) break
  }

  return chunks
}

async function main() {
  const options = parseArgs()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const chunks = await loadChunks(supabase, options)
  let candidates = 0
  let entitiesUpserted = 0
  let linksUpserted = 0
  const byType = new Map<string, number>()
  const now = new Date().toISOString()
  const entityRows = new Map<string, {
    tenant_id: string | null
    entity_type: string
    canonical_name: string
    normalized_name: string
    aliases: string[]
    metadata: Record<string, unknown>
    updated_at: string
  }>()
  const linkCandidates: Array<{
    entityKey: string
    chunk_id: string
    relation: 'mentions'
    confidence: number
    evidence_text: string | null
  }> = []

  for (const chunk of chunks) {
    const entities = extractGraphLiteEntities(chunk)
    candidates += entities.length
    for (const entity of entities) {
      byType.set(entity.entityType, (byType.get(entity.entityType) ?? 0) + 1)
      if (options.dryRun) continue

      const normalizedName = normalizeGraphEntityName(entity.canonicalName)
      const entityKey = `${chunk.tenant_id ?? 'null'}:${entity.entityType}:${normalizedName}`
      const existing = entityRows.get(entityKey)
      if (existing) {
        existing.aliases = [...new Set([...existing.aliases, ...entity.aliases])]
        existing.metadata = { ...existing.metadata, ...entity.metadata }
      } else {
        entityRows.set(entityKey, {
          tenant_id: chunk.tenant_id,
          entity_type: entity.entityType,
          canonical_name: entity.canonicalName,
          normalized_name: normalizedName,
          aliases: entity.aliases,
          metadata: entity.metadata,
          updated_at: now,
        })
      }

      linkCandidates.push({
        entityKey,
        chunk_id: chunk.id,
        relation: 'mentions',
        confidence: entity.confidence,
        evidence_text: entity.evidenceText,
      })
    }
  }

  if (!options.dryRun && entityRows.size > 0) {
    const entityIdByKey = new Map<string, string>()
    const rows = [...entityRows.entries()]

    for (const rowsBatch of batch(rows, 200)) {
      const { data, error } = await supabase
        .from('jarvis_knowledge_entities')
        .upsert(rowsBatch.map(([, row]) => row), { onConflict: 'tenant_id,entity_type,normalized_name' })
        .select('id, tenant_id, entity_type, normalized_name')
      if (error) throw error

      for (const row of data ?? []) {
        const key = `${row.tenant_id ?? 'null'}:${row.entity_type}:${row.normalized_name}`
        entityIdByKey.set(key, row.id)
      }
      entitiesUpserted += rowsBatch.length
    }

    const linkRowsByKey = new Map<string, {
      entity_id: string
      chunk_id: string
      relation: 'mentions'
      confidence: number
      evidence_text: string | null
    }>()

    for (const candidate of linkCandidates) {
      const entityId = entityIdByKey.get(candidate.entityKey)
      if (!entityId) continue
      const linkKey = `${entityId}:${candidate.chunk_id}:${candidate.relation}`
      const existing = linkRowsByKey.get(linkKey)
      if (!existing || candidate.confidence > existing.confidence) {
        linkRowsByKey.set(linkKey, {
          entity_id: entityId,
          chunk_id: candidate.chunk_id,
          relation: candidate.relation,
          confidence: candidate.confidence,
          evidence_text: candidate.evidence_text,
        })
      }
    }

    for (const linksBatch of batch([...linkRowsByKey.values()], 500)) {
      const { error } = await supabase
        .from('jarvis_knowledge_entity_links')
        .upsert(linksBatch, { onConflict: 'entity_id,chunk_id,relation' })
      if (error) throw error
      linksUpserted += linksBatch.length
    }
  }

  if (!options.dryRun) {
    const { error: refreshError } = await supabase.rpc('refresh_jarvis_knowledge_entity_counts')
    if (refreshError && !refreshError.message.includes('Could not find the function')) {
      throw refreshError
    }
  }

  const payload = {
    dryRun: options.dryRun,
    sourceFilter: options.sourceType,
    chunks: chunks.length,
    candidates,
    entitiesUpserted,
    linksUpserted,
    byType: Object.fromEntries([...byType.entries()].sort()),
  }

  if (options.json) console.log(JSON.stringify(payload, null, 2))
  else {
    console.log(`Jarvis GraphRAG-lite sync: chunks=${payload.chunks}, candidates=${payload.candidates}, links=${payload.linksUpserted}`)
    for (const [type, count] of Object.entries(payload.byType)) {
      console.log(`- ${type}: ${count}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
