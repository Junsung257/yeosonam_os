/**
 * destination_climate.seasonal_signals 자동 빌드
 *
 * Pipeline:
 *  1. destination_climate에서 모든 row + climate fitness_scores 로드
 *  2. Naver DataLab 5개씩 grouping (rate limit 1000 calls/day)
 *  3. Wikipedia 한국어 페이지뷰 fetch (article = primary_city, fallback destination)
 *  4. synthesizeSignals → seasonal_signals jsonb UPSERT
 *
 * 실행:
 *   node db/build_seasonal.js              # 신규/누락만
 *   node db/build_seasonal.js --force      # 전체 재빌드
 *   node db/build_seasonal.js --dest 다낭/호이안   # 특정 destination
 *   node db/build_seasonal.js --dry        # DB 쓰기 없음
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const env = {};
fs.readFileSync('.env.local', 'utf-8').split('\n').forEach(l => {
  const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');
const destFilter = args[args.indexOf('--dest') + 1];

// ─── seasonal-signals.ts 미러링 (require가 안 되는 .ts 회피) ───────
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

async function fetchNaverTrend(keywordGroups, startDate, endDate) {
  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ startDate, endDate, timeUnit: 'month', keywordGroups }),
  });
  if (!res.ok) throw new Error(`Naver ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchWikiPageviews(articleTitle, startYYYYMM, endYYYYMM) {
  const encoded = encodeURIComponent(articleTitle.replace(/ /g, '_'));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ko.wikipedia/all-access/all-agents/${encoded}/monthly/${startYYYYMM}0100/${endYYYYMM}0100`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'yeosonam-os-research/1.0 (zzbaa0317@gmail.com)' },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Wikipedia ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.items ?? []).map(x => ({
    year: Number(x.timestamp.slice(0, 4)),
    month: Number(x.timestamp.slice(4, 6)),
    views: x.views,
  }));
}

function monthlyIndex(values) {
  const byMonth = new Map();
  for (const v of values) {
    if (!byMonth.has(v.month)) byMonth.set(v.month, []);
    byMonth.get(v.month).push(v.value);
  }
  const monthAvg = new Map();
  for (const [m, arr] of byMonth) monthAvg.set(m, arr.reduce((a, b) => a + b, 0) / arr.length);
  const totalAvg = [...monthAvg.values()].reduce((a, b) => a + b, 0) / Math.max(1, monthAvg.size);
  if (!totalAvg) return new Map();
  const result = new Map();
  for (const m of MONTHS) {
    const v = monthAvg.get(m) ?? 0;
    result.set(m, { idx: v / totalAvg, raw: v });
  }
  return result;
}

function popularityScore(idx) {
  return Math.round(Math.max(0, Math.min(100, 50 + (idx - 1) * 80)));
}

function badgeFor(month, climate, type) {
  if (type === 'snow_or_special') {
    if (month >= 12 || month <= 2) return '❄️ 눈여행·온천 시즌';
    if (month >= 5 && month <= 9) return '☔ 우기지만 한국 휴가 시즌';
    return '🎯 시즌 이벤트 추정';
  }
  if (month === 1 || month === 2) return '🇰🇷 설·겨울 휴가 시즌';
  if (month >= 3 && month <= 5) return '🌸 봄 여행 시즌';
  if (month >= 6 && month <= 8) return '☀️ 여름 휴가 시즌';
  if (month >= 9 && month <= 11) return '🍁 가을 여행 시즌';
  return '⭐ 한국인 선호 시즌';
}

function autoLabel(idx, climateScore, month) {
  if (idx >= 1.30) {
    if (climateScore < 35) return { label: '한국인 매우 인기 시즌', badge: badgeFor(month, climateScore, 'snow_or_special') };
    return { label: '한국인 매우 인기 시즌', badge: badgeFor(month, climateScore, 'peak') };
  }
  if (idx >= 1.15) {
    if (climateScore < 35) return { label: '한국인 인기 시즌', badge: badgeFor(month, climateScore, 'snow_or_special') };
    return { label: '한국인 인기 시즌', badge: badgeFor(month, climateScore, 'peak') };
  }
  if (idx >= 0.95) return { label: '평균 수준', badge: null };
  if (idx >= 0.80) return { label: '비수기 (수요 ↓)', badge: null };
  return { label: '비수기 (수요 매우 낮음)', badge: null };
}

function synthesizeSignals(naverData, wikiData, climateScores) {
  const naverIdx = monthlyIndex(naverData.map(d => ({ month: Number(d.period.slice(5, 7)), value: d.ratio })));
  const wikiIdx = monthlyIndex(wikiData.map(d => ({ month: d.month, value: d.views })));

  return MONTHS.map(month => {
    const n = naverIdx.get(month);
    const w = wikiIdx.get(month);
    const naver_idx = n?.idx ?? 0;
    const wiki_idx = w?.idx ?? 0;
    const naver_ratio = +(n?.raw ?? 0).toFixed(2);
    const wiki_views = Math.round(w?.raw ?? 0);

    let seasonality_index;
    if (naver_idx > 0 && wiki_idx > 0) seasonality_index = 0.7 * naver_idx + 0.3 * wiki_idx;
    else if (naver_idx > 0) seasonality_index = naver_idx;
    else if (wiki_idx > 0) seasonality_index = wiki_idx;
    else seasonality_index = 1.0;

    const agreement = (naver_idx > 0 && wiki_idx > 0)
      ? 1 - Math.abs(naver_idx - wiki_idx) / Math.max(naver_idx, wiki_idx)
      : 0.5;

    const popularity_score = popularityScore(seasonality_index);
    const climate = climateScores.find(c => c.month === month)?.score ?? 50;
    const { label, badge } = autoLabel(seasonality_index, climate, month);

    return {
      month,
      naver_idx: +naver_idx.toFixed(3), naver_ratio,
      wiki_idx: +wiki_idx.toFixed(3), wiki_views,
      seasonality_index: +seasonality_index.toFixed(3),
      agreement: +agreement.toFixed(2),
      popularity_score, label, badge,
    };
  });
}

// ─── destination별 검색 키워드 매핑 ────────────────────────────────
// primary_city + 동의어 (한국인이 검색할만한 표기들)
const KEYWORD_MAP = {
  '장가계': ['장가계', '장가계여행'],
  '칭다오': ['칭다오', '청도', '칭다오여행'],
  '서안': ['서안', '시안', '서안여행'],
  '석가장': ['석가장', '태항산'],
  '천진': ['천진', '톈진', '천진여행'],
  '베이징': ['베이징', '북경', '북경여행'],
  '구채구': ['구채구', '주자이거우'],
  '란주': ['란주', '란저우'],
  '황산': ['황산', '황산여행'],
  '라싸': ['라싸', '티벳', '티베트'],
  '호화호특': ['호화호특', '후허하오터', '내몽골'],
  '시즈오카': ['시즈오카', '시즈오카여행'],
  '나가사키': ['나가사키', '나가사키여행'],
  '삿포로': ['삿포로', '북해도', '홋카이도'],
  '후쿠오카': ['후쿠오카', '후쿠오카여행'],
  '오사카': ['오사카', '오사카여행'],
  '나하': ['오키나와', '나하', '오키나와여행'],
  '나트랑': ['나트랑', '냐짱', '나트랑여행'],
  '다낭': ['다낭', '다낭여행', '호이안'],
  '하노이': ['하노이', '하롱베이', '하노이여행'],
  '푸꾸옥': ['푸꾸옥', '푸꾸옥여행'],
  '호치민': ['호치민', '사이공', '호치민여행'],
  '보홀': ['보홀', '보홀여행'],
  '세부': ['세부', '세부여행'],
  '치앙마이': ['치앙마이', '치앙라이', '치앙마이여행'],
  '비엔티엔': ['비엔티엔', '라오스', '루앙프라방', '방비엥'],
  '울란바토르': ['울란바토르', '몽골', '몽골여행'],
  '덴파사르': ['발리', '덴파사르', '발리여행'],
  '쿠알라룸푸르': ['쿠알라룸푸르', '말레이시아', '싱가포르'],
  '마카오': ['마카오', '홍콩', '마카오여행'],
  '타이페이': ['타이페이', '타이베이', '대만'],
};

(async () => {
  // 1) destination_climate 로드
  let q = sb.from('destination_climate').select('destination, primary_city, country, fitness_scores, seasonal_signals');
  if (destFilter) q = q.eq('destination', destFilter);
  const { data: rows, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }

  // 2) primary_city별 그룹핑 (같은 도시는 한 번만 fetch)
  const byCity = new Map();
  for (const r of rows) {
    if (!FORCE && r.seasonal_signals && Array.isArray(r.seasonal_signals) && r.seasonal_signals.length === 12) continue;
    if (!byCity.has(r.primary_city)) byCity.set(r.primary_city, { ...r, members: [] });
    byCity.get(r.primary_city).members.push(r);
  }

  if (byCity.size === 0) { console.log('갱신할 row 없음 (--force 로 강제 재빌드)'); return; }
  console.log(`📍 ${byCity.size}개 도시 / 총 ${[...byCity.values()].reduce((a, c) => a + c.members.length, 0)}개 destination 처리`);

  const groups = [...byCity.values()];
  // 3) Naver — 5개씩 chunked, 12개월 fetch
  const cityToNaver = new Map();
  const startDate = '2024-01-01', endDate = '2024-12-31';

  for (let i = 0; i < groups.length; i += 5) {
    const chunk = groups.slice(i, i + 5);
    const keywordGroups = chunk.map(c => ({
      groupName: c.primary_city,
      keywords: KEYWORD_MAP[c.primary_city] || [c.primary_city],
    }));
    console.log(`\n🔍 Naver chunk ${i / 5 + 1}: ${chunk.map(c => c.primary_city).join(', ')}`);
    try {
      const resp = await fetchNaverTrend(keywordGroups, startDate, endDate);
      for (const res of resp.results) {
        cityToNaver.set(res.title, res.data);
      }
    } catch (e) {
      console.error(`  ✗ Naver: ${e.message}`);
      for (const c of chunk) cityToNaver.set(c.primary_city, []);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // 4) Wikipedia 한국어 페이지뷰 — 도시당 1회
  const cityToWiki = new Map();
  for (const g of groups) {
    try {
      const data = await fetchWikiPageviews(g.primary_city, '202401', '202412');
      cityToWiki.set(g.primary_city, data);
      console.log(`  📖 wiki ${g.primary_city}: ${data.length}개 월 데이터`);
    } catch (e) {
      console.error(`  ✗ wiki ${g.primary_city}: ${e.message}`);
      cityToWiki.set(g.primary_city, []);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 5) 합성 + UPSERT
  let okCount = 0, failCount = 0;
  for (const g of groups) {
    const naverData = cityToNaver.get(g.primary_city) || [];
    const wikiData = cityToWiki.get(g.primary_city) || [];

    if (naverData.length === 0 && wikiData.length === 0) {
      console.log(`  ⚠️  ${g.primary_city}: 두 출처 모두 데이터 없음 — popularity=50 (평균) 처리`);
    }

    const climateScores = (g.fitness_scores || []).map(s => ({ month: Number(s.month), score: Number(s.score) }));
    const signals = synthesizeSignals(naverData, wikiData, climateScores);

    // 요약 출력
    const peak = signals.reduce((a, b) => a.popularity_score > b.popularity_score ? a : b);
    const low = signals.reduce((a, b) => a.popularity_score < b.popularity_score ? a : b);
    console.log(`\n● ${g.primary_city}: peak ${peak.month}월 ${peak.popularity_score}점${peak.badge ? ` "${peak.badge}"` : ''} / low ${low.month}월 ${low.popularity_score}점`);

    if (DRY) { okCount += g.members.length; continue; }

    for (const m of g.members) {
      const { error: uErr } = await sb.from('destination_climate')
        .update({ seasonal_signals: signals })
        .eq('destination', m.destination);
      if (uErr) { console.error(`  ✗ ${m.destination}: ${uErr.message}`); failCount++; }
      else okCount++;
    }
  }

  console.log(`\n${DRY ? '[DRY] ' : ''}완료: ${okCount}개 갱신, ${failCount}개 실패`);
})();
