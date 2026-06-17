import { indexDoc } from '@/lib/jarvis/rag/indexer'
import { getJarvisPolicyKnowledgeDocs, JARVIS_POLICY_KNOWLEDGE_VERSION } from '@/lib/jarvis/rag/policy-knowledge'

async function main() {
  const docs = getJarvisPolicyKnowledgeDocs()
  let inserted = 0
  let skipped = 0
  let failed = 0

  for (const doc of docs) {
    const result = await indexDoc(doc)
    inserted += result.inserted
    skipped += result.skipped
    failed += result.failed
    console.log(`${doc.sourceTitle}: inserted=${result.inserted} skipped=${result.skipped} failed=${result.failed}`)
  }

  console.log(JSON.stringify({
    version: JARVIS_POLICY_KNOWLEDGE_VERSION,
    docs: docs.length,
    inserted,
    skipped,
    failed,
  }, null, 2))

  if (failed > 0) {
    process.exit(1)
  }
}

void main()
