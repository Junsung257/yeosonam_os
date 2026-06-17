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

  for (const chunk of chunks) {
    const entities = extractGraphLiteEntities(chunk)
    candidates += entities.length
    for (const entity of entities) {
      byType.set(entity.entityType, (byType.get(entity.entityType) ?? 0) + 1)
      if (options.dryRun) continue

      const { data: entityRow, error: entityError } = await supabase
        .from('jarvis_knowledge_entities')
        .upsert({
          tenant_id: chunk.tenant_id,
          entity_type: entity.entityType,
          canonical_name: entity.canonicalName,
          normalized_name: normalizeGraphEntityName(entity.canonicalName),
          aliases: entity.aliases,
          metadata: entity.metadata,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,entity_type,normalized_name' })
        .select('id')
        .single()
      if (entityError) throw entityError
      entitiesUpserted++

      const { error: linkError } = await supabase
        .from('jarvis_knowledge_entity_links')
        .upsert({
          entity_id: entityRow.id,
          chunk_id: chunk.id,
          relation: 'mentions',
          confidence: entity.confidence,
          evidence_text: entity.evidenceText,
        }, { onConflict: 'entity_id,chunk_id,relation' })
      if (linkError) throw linkError
      linksUpserted++
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
