#!/usr/bin/env tsx

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config()

function readNumberArg(args: string[], name: string, fallback: number): number {
  const prefix = `${name}=`
  const raw = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const value = raw ? Number(raw) : fallback
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function withQueryTimeout<T>(
  label: string,
  query: { abortSignal: (signal: AbortSignal) => PromiseLike<T> },
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await query.abortSignal(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function runCount(
  label: string,
  query: { abortSignal: (signal: AbortSignal) => PromiseLike<{ count: number | null; error: { message?: string } | null }> },
  timeoutMs: number,
) {
  const result = await withQueryTimeout(label, query, timeoutMs)
  return {
    label,
    count: result.count ?? null,
    error: result.error ? `${label}: ${result.error.message ?? String(result.error)}` : null,
  }
}

async function main() {
  const timeoutMs = readNumberArg(process.argv.slice(2), '--timeout-ms', 15000)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const startedAt = Date.now()
  const chunks = await runCount('chunks count', supabase.from('jarvis_knowledge_chunks').select('id', { count: 'exact', head: true }), timeoutMs)
  const policies = await runCount('policy chunks count', supabase.from('jarvis_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('source_type', 'policy'), timeoutMs)
  const entities = await runCount('graph entities count', supabase.from('jarvis_knowledge_entities').select('id', { count: 'exact', head: true }), timeoutMs)
  const links = await runCount('graph links count', supabase.from('jarvis_knowledge_entity_links').select('id', { count: 'exact', head: true }), timeoutMs)

  const errors = [chunks.error, policies.error, entities.error, links.error].filter(Boolean)
  const payload = {
    ok: errors.length === 0,
    latencyMs: Date.now() - startedAt,
    timeoutMs,
    chunks: chunks.count,
    policyChunks: policies.count,
    graphEntities: entities.count,
    graphLinks: links.count,
    errors,
  }

  console.log(JSON.stringify(payload, null, 2))
  if (!payload.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
