/**
 * Phase 2 — 외부 데이터 (Wikidata SPARQL + Wikipedia REST) 실측.
 * 사장님 비전 (NER+NEL+contextual LLM) 의 실제 정확도 측정.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// 장가계 패키지 핵심 명사 후보 (실제 일정표에서 추출)
const KEYWORDS = [
  // 진짜 관광지 (positive expected)
  { kw: '범정산', expected: true, group: 'real-attraction' },
  { kw: '동인대협곡', expected: true, group: 'real-attraction' },
  { kw: '봉황고성', expected: true, group: 'real-attraction' },
  { kw: '천문산', expected: true, group: 'real-attraction' },
  { kw: '장가계대협곡', expected: true, group: 'real-attraction' },
  { kw: '천자산', expected: true, group: 'real-attraction' },
  { kw: '백룡엘리베이터', expected: true, group: 'real-attraction' },
  { kw: '천문산사', expected: true, group: 'real-attraction' },
  { kw: '천하제일교', expected: true, group: 'real-attraction' },
  { kw: '미혼대', expected: true, group: 'real-attraction' },
  // 도시명 (부모 destination — attraction 아님)
  { kw: '장가계', expected: false, group: 'parent-city' },
  { kw: '동인', expected: false, group: 'parent-city' },
  // 부속 명소 (Wikidata 미커버 가능)
  { kw: '선녀헌화', expected: true, group: 'small-attraction' },
  { kw: '후화원', expected: true, group: 'small-attraction' },
  { kw: '어필봉', expected: true, group: 'small-attraction' },
  { kw: '하룡공원', expected: true, group: 'small-attraction' },
  { kw: '72기루', expected: true, group: 'small-attraction' },
  { kw: '천문호선쇼', expected: true, group: 'small-attraction' },
  { kw: '군성사석화박물관', expected: true, group: 'small-attraction' },
  // 부속 코스 (attraction 아님 / 너무 작음)
  { kw: '마고석', expected: false, group: 'sub-course' },
  { kw: '노금정', expected: false, group: 'sub-course' },
  { kw: '홍운금정', expected: false, group: 'sub-course' },
  { kw: '유천', expected: false, group: 'sub-course' },
  { kw: '귀곡잔도', expected: true, group: 'sub-course' },  // 실제는 attraction
  { kw: '유리잔도', expected: true, group: 'sub-course' },  // 천문산 부속, attraction
  // 일반명사 (attraction 아님)
  { kw: '유리다리', expected: false, group: 'common-noun' },
  { kw: '엘리베이터', expected: false, group: 'common-noun' },
  { kw: '봅슬레이', expected: false, group: 'common-noun' },
  { kw: '케이블카', expected: false, group: 'common-noun' },
  { kw: '대협곡', expected: false, group: 'common-noun' },
];

// Wikipedia ko REST API
async function wikiSearch(kw: string): Promise<{ hits: number; firstTitle?: string; firstSize?: number; isDisambig?: boolean }> {
  try {
    const r = await fetch(`https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(kw)}&format=json&srlimit=5&srprop=size`);
    const j = await r.json() as { query?: { search?: Array<{ title: string; size: number }> } };
    const hits = j.query?.search ?? [];
    const first = hits[0];
    // 동음이의 문서 감지
    const isDisambig = first?.title?.endsWith('(동음이의)') || false;
    return { hits: hits.length, firstTitle: first?.title, firstSize: first?.size, isDisambig };
  } catch { return { hits: 0 }; }
}

// Wikidata SPARQL
async function wikidataLookup(kw: string): Promise<{ count: number; firstQid?: string; firstLabel?: string; instances?: string[] }> {
  // 한국어/영어/중문 라벨 검색 + P31 instance-of 가져옴
  const sparql = `
    SELECT DISTINCT ?item ?itemLabel (GROUP_CONCAT(DISTINCT ?p31Label; SEPARATOR=", ") AS ?instances) WHERE {
      { ?item rdfs:label "${kw}"@ko. }
      UNION { ?item rdfs:label "${kw}"@zh. }
      UNION { ?item skos:altLabel "${kw}"@ko. }
      OPTIONAL { ?item wdt:P31 ?p31. ?p31 rdfs:label ?p31Label. FILTER(LANG(?p31Label) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en". }
    } GROUP BY ?item ?itemLabel LIMIT 5
  `;
  try {
    const r = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: { 'User-Agent': 'yeosonam-os/1.0 (research)' },
    });
    if (!r.ok) return { count: -1 };
    const j = await r.json() as { results?: { bindings?: Array<{ item: { value: string }; itemLabel: { value: string }; instances?: { value: string } }> } };
    const rows = j.results?.bindings ?? [];
    const first = rows[0];
    return {
      count: rows.length,
      firstQid: first?.item.value.split('/').pop(),
      firstLabel: first?.itemLabel.value,
      instances: rows.map(r => r.instances?.value ?? '').filter(Boolean),
    };
  } catch (e) { return { count: -2 }; }
}

(async () => {
  console.log('═══ Wikidata + Wikipedia 실측 (장가계 30 키워드) ═══\n');
  console.log('keyword'.padEnd(15) + ' expect  wd(qid/instances)              wiki(hits/size)');
  console.log('-'.repeat(95));

  const results: Array<{ kw: string; expected: boolean; group: string; wdCount: number; wdInstances?: string; wikiHits: number; wikiSize?: number }> = [];
  for (const t of KEYWORDS) {
    const [wd, wiki] = await Promise.all([wikidataLookup(t.kw), wikiSearch(t.kw)]);
    const wdInst = wd.instances?.[0]?.split(', ').slice(0, 3).join('|') ?? '-';
    const wdLabel = wd.firstQid ? `${wd.count}(${wd.firstQid} ${wdInst.slice(0,30)})` : '0';
    const wikiLabel = wiki.hits > 0 ? `${wiki.hits}/${wiki.firstSize ?? '?'}` : '0';
    const expectIcon = t.expected ? '✓' : '✗';
    console.log(`  ${t.kw.padEnd(13)} ${expectIcon}       ${wdLabel.padEnd(35)} ${wikiLabel}`);
    results.push({ kw: t.kw, expected: t.expected, group: t.group, wdCount: wd.count, wdInstances: wdInst, wikiHits: wiki.hits, wikiSize: wiki.firstSize });
    await new Promise(r => setTimeout(r, 300));  // SPARQL 부하 방지
  }

  // 정확도 분석
  console.log('\n═══ 정확도 분석 ═══');

  // 룰 A: Wikidata 1개 매칭 → attraction
  const ruleA = results.map(r => ({ ...r, predicted: r.wdCount === 1 }));
  const ruleAcc = (ruleA.filter(r => r.predicted === r.expected).length / ruleA.length * 100).toFixed(0);
  const ruleAfp = ruleA.filter(r => r.predicted && !r.expected).map(r => r.kw);
  const ruleAfn = ruleA.filter(r => !r.predicted && r.expected).map(r => r.kw);
  console.log(`  [룰 A] Wikidata 정확 1개 매칭 = attraction`);
  console.log(`     정확도: ${ruleAcc}%  False Positive: [${ruleAfp.join(', ')}]  False Negative: [${ruleAfn.join(', ')}]`);

  // 룰 B: Wikipedia 1+개 hit AND size 500+ → attraction
  const ruleB = results.map(r => ({ ...r, predicted: r.wikiHits >= 1 && (r.wikiSize ?? 0) >= 500 }));
  const accB = (ruleB.filter(r => r.predicted === r.expected).length / ruleB.length * 100).toFixed(0);
  const fpB = ruleB.filter(r => r.predicted && !r.expected).map(r => r.kw);
  const fnB = ruleB.filter(r => !r.predicted && r.expected).map(r => r.kw);
  console.log(`  [룰 B] Wikipedia 1+개 hit + size 500+`);
  console.log(`     정확도: ${accB}%  FP: [${fpB.join(', ')}]  FN: [${fnB.join(', ')}]`);

  // 룰 C: Wikipedia 1+ AND Wikidata 1+ AND NOT 도시명/장가계 등
  const ruleC = results.map(r => {
    const pred = r.wikiHits >= 1 && r.wdCount >= 1 && !['장가계', '동인'].includes(r.kw);
    return { ...r, predicted: pred };
  });
  const accC = (ruleC.filter(r => r.predicted === r.expected).length / ruleC.length * 100).toFixed(0);
  const fpC = ruleC.filter(r => r.predicted && !r.expected).map(r => r.kw);
  const fnC = ruleC.filter(r => !r.predicted && r.expected).map(r => r.kw);
  console.log(`  [룰 C] Wikipedia 1+ AND Wikidata 1+ AND NOT 부모destination`);
  console.log(`     정확도: ${accC}%  FP: [${fpC.join(', ')}]  FN: [${fnC.join(', ')}]`);

  // 룰 D: Wikidata 1개 AND instance P31 = 관광지 카테고리
  const TOURIST_P31 = /mountain|lake|museum|tourist|park|temple|cave|castle|river|waterfall|peak|gorge|canyon|hill|stupa|monument|shrine|island|valley/i;
  const ruleD = results.map(r => {
    const pred = r.wdCount === 1 && TOURIST_P31.test(r.wdInstances ?? '');
    return { ...r, predicted: pred };
  });
  const accD = (ruleD.filter(r => r.predicted === r.expected).length / ruleD.length * 100).toFixed(0);
  const fpD = ruleD.filter(r => r.predicted && !r.expected).map(r => r.kw);
  const fnD = ruleD.filter(r => !r.predicted && r.expected).map(r => r.kw);
  console.log(`  [룰 D] Wikidata 1개 AND P31 ∈ tourist categories`);
  console.log(`     정확도: ${accD}%  FP: [${fpD.join(', ')}]  FN: [${fnD.join(', ')}]`);

  // ===== group별 커버리지 분석 =====
  console.log('\n═══ 그룹별 외부 KB 커버리지 ═══');
  const groups = [...new Set(results.map(r => r.group))];
  for (const g of groups) {
    const sub = results.filter(r => r.group === g);
    const wdHit = sub.filter(r => r.wdCount >= 1).length;
    const wikiHit = sub.filter(r => r.wikiHits >= 1).length;
    console.log(`  ${g.padEnd(18)} N=${sub.length}  Wikidata hit ${wdHit}/${sub.length}  Wikipedia hit ${wikiHit}/${sub.length}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
