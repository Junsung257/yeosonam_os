import { retrieve } from '@/lib/jarvis/rag/retriever'

const queries = [
  '다낭 가족여행 추천',
  '나트랑 가격 비교해줘',
  '환불 규정 알려줘',
]

async function main() {
  const results = []

  for (const query of queries) {
    const hits = await retrieve({
      query,
      sourceTypes: ['package', 'blog', 'policy'],
      limit: 3,
    })

    results.push({
      query,
      count: hits.length,
      top: hits[0]
        ? {
            sourceType: hits[0].sourceType,
            sourceTitle: hits[0].sourceTitle,
            vectorScore: hits[0].vectorScore,
            bm25Score: hits[0].bm25Score,
            score: hits[0].score,
          }
        : null,
    })
  }

  console.log(JSON.stringify(results, null, 2))

  if (results.some((result) => result.count === 0)) {
    process.exit(1)
  }
}

void main()
