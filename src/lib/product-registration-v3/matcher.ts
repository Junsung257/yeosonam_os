import { matchAttraction, type AttractionData } from '@/lib/attraction-matcher';
import type { V3DraftLedger, V3MatchSummary } from './types';
import { buildV3EntitySummary } from './entity-normalizer';

function cloneLedger(ledger: V3DraftLedger): V3DraftLedger {
  return JSON.parse(JSON.stringify(ledger)) as V3DraftLedger;
}

const DESCRIPTIVE_ATTRACTION_PREFIX_RE =
  /^[\s\u25b6\u25cf\u2022\u00b7\u25c6\u25c7\u25a0\u25a1\u2605\u2606+\-\u2663\u220e\u203b]+/;

function normalizedAttractionCandidate(value: string): string {
  return value
    .replace(DESCRIPTIVE_ATTRACTION_PREFIX_RE, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(?:\uad00\uad11|\uc0b0\ucc45|\uccb4\ud5d8|\ubc29\ubb38|\uc870\ub9dd)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pushCandidate(candidates: string[], value: string | null | undefined): void {
  const normalized = normalizedAttractionCandidate(value ?? '');
  if (normalized.length < 2 || normalized.length > 40) return;
  if (!candidates.some(existing => existing.replace(/\s+/g, '') === normalized.replace(/\s+/g, ''))) {
    candidates.push(normalized);
  }
}

const NON_ATTRACTION_CANDIDATE_RE =
  /^(?:전용|임주|석가장|치토세|삿포로|도야|오타루|후라노|비에이|노보리베츠|죠잔케이|동경|나리타|이도백화|출발확정|출확|마감|선발권조건|6일|=>)$/;

const NON_ATTRACTION_TEXT_RE =
  /(?:^\(?성인\s*\/\s*아동\s*동일\)?$|^\(?자유식\)?$|^\(?무제한\)?$|삼겹구이|모듬구이|씨푸드|짜조|스테이크\s*정식|세트메뉴|텐동소바세트|카츠카레\s*정식|해산물\s*철판구이|분짜|반쎄오|노미호다이|석-한\s*식|열대\s*과일\s*시식|소프트\s*아이스크림|온천계란|밀크티|생강차|멜리아\s*빈펄|동급\s*\(5성\)|일정\s*중\s*내\s*마음대로\s*택|아융강\s*래프팅|왕복케이블카|루지편도|유리잔도|유리전망대|도야\s*불꽃놀이|북해도\s*품격|비에이ㆍ오타루|출확|노노|차장관광|차창관광|달콤한\s*로맨틱\s*오타루\s*과자|해당일\s*제외일자|별도문의|선발권|출발확정|초특가|특가|추석|사원\s*관람시|입장\s*불가|비운항일|^확인$|^[월화수목금토일]{2,7}$|^\(?\d{1,2}\/\d{1,2}(?:,\d{1,2})*제외\)?$|돈까스|넘능\s*세트|왕새우|민물가재|오징어볶음|가리비구이|문어구이|소고기안심구이|치킨윙|올유캔잇|우렁이찜|핫팟|소고기모듬|닭구이|대통밥정식|미식|레스토랑|카페|수박\s*쥬스|^\d{1,2}[./-]\d{1,2}(?:\s*[~-]\s*\d{1,2}[./-]?\d{0,2})?$|^\d{1,2}[./-]\d{1,2}(?:,\s*\d{1,2})+|^\d{1,2}[./-]\d{1,2}까지$)/;

const NORMAL_NON_ATTRACTION_TEXT_RE =
  /^(?:[A-Z]{3}(?:-[A-Z]{3})?|#?시즈오카|#?다색골프|제외\s*일자|\d+\s*\+\s*\d+|\(?\d{1,4}(?:,\d{3})?\s*엔\)?|\*?인원미달\s*요금추가|\*?사가라CC\s*미진행시\s*쿨카트\s*제공\s*X|\*?오후\s*플레이\s*욕장\s*\+\s*락커\s*사용\s*불가.*)$/i;

const DESCRIPTION_LABEL_RULES: Array<[RegExp, string]> = [
  [/종고루광장\s*야경|종고루광장/i, '종고루광장 야시장'],
  [/북봉.*천제용령.*(?:상용령|금사관|중봉|남봉)/i, '화산'],
  [/진나라\s*2세\s*효예묘|진나라2세효예묘|효예묘/i, '진나라2세호혜묘'],
  [/달랏\s*기차역|기차역\s*달랏\s*기차역/i, '달랏기차역'],
  [/도멘\s*드\s*마리\s*성당|핑크빛\s*건축물\s*수녀원/i, '도멘 드 마리 성당'],
  [/도멘드\s*드\s*마리\s*성당/i, '도멘 드 마리 성당'],
  [/천국의\s*계단/i, '천국의계단'],
  [/압록강\s*대협곡/i, '압록강대협곡'],
  [/조선족\s*민속원|전통\s*한옥\s*마을.*민속원/i, '연길민속촌'],
  [/다딴라\s*폭포|레일바이크/i, '다딴라 폭포'],
  [/쑤언흐엉|쑤언\s*흐엉/i, '쑤언흐엉호수'],
  [/플라워가든|꽃정원/i, '달랏 플라워가든'],
  [/바오다이|여름별장/i, '바오다이 황제 여름별장'],
  [/영흥사|해수관음/i, '영흥사'],
  [/다낭\s*대성당/i, '다낭대성당'],
  [/꾸따\s*해변|꾸따\s*핫플레이스/i, '꾸따해변'],
  [/가루다\s*국립공원|가루다상|비쉬누상/i, '가루다 위시누 켄카나 문화공원'],
  [/오르골당/i, '오르골당'],
  [/오타루\s*운하|오타루운하/i, '오타루 운하'],
  [/지옥계곡/i, '지옥계곡'],
  [/시키사이노오카|사계채의\s*언덕/i, '시키사이노오카'],
  [/아오이이케|청의\s*호수/i, '아오이이케'],
  [/흰수염\s*폭포/i, '흰수염폭포'],
  [/팜\s*토미타|팜도미타/i, '팜토미타'],
  [/삿포로\s*시계탑|맑은\s*종소리/i, '삿포로 시계탑'],
  [/패치워크의\s*길/i, '패치워크의 길'],
  [/유후인\s*민예거리|민예거리/i, '유후인 민예거리'],
  [/긴린호수/i, '긴린호수'],
  [/마이즈루\s*공원|후쿠오카\s*성터/i, '마이즈루 공원'],
  [/아타미\s*매화원/i, '아타미 매화원'],
  [/아타미\s*친수공원/i, '아타미 친수공원'],
  [/슈젠지/i, '슈젠지'],
  [/오와쿠다니/i, '오와쿠다니 유황계곡'],
  [/5\.?4\s*광장/i, '5.4광장'],
  [/팔대관/i, '팔대관'],
  [/잔교/i, '잔교'],
  [/대당불야성|불야성/i, '대당불야성'],
  [/춘쿤산/i, '춘쿤산'],
  [/내몽고\s*박물관/i, '내몽고박물관'],
  [/사이샹\s*옛거리/i, '사이샹 옛거리'],
  [/멍량풍정원|몽량풍정원/i, '멍량풍정원'],
  [/모아산/i, '모아산국가 삼림공원'],
  [/토가족풍정원|토가풍정원/i, '토가풍정원'],
  [/천문동|하늘로통하는문/i, '천문동'],
  [/옌뜨|옌뜨국립공원/i, '옌뜨'],
  [/항루언|항루원/i, '항루언'],
  [/석회동굴|하늘문|선녀탕/i, '하롱 석회동굴'],
  [/하롱테마파크/i, '하롱테마파크'],
  [/통천호|석방부두|희수광장|천하호구|금귀교|용세담|금귀호/i, '통천호'],
  [/환산선/i, '환산선 풍경구'],
  [/황용담|함주|일월유천|이용희주|구련폭포/i, '보천 풍경구'],
  [/천갱|성녀봉|수녀봉|불어대/i, '천계산'],
  [/호치민생가|한기둥사원|바딘광장/i, '하노이 시내 관광'],
  [/옥산사/i, '옥산사'],
  [/융드레우물|용정지역의\s*기원/i, '융드레우물'],
  [/오시노핫카이/i, '오시노핫카이'],
];
const DESCRIPTION_LABEL_FALLBACKS = new Set(DESCRIPTION_LABEL_RULES.map(([, label]) => label.replace(/\s+/g, '')));

function isNonAttractionCandidate(rawText: string): boolean {
  const cleaned = normalizedAttractionCandidate(rawText);
  const compact = cleaned.replace(/\s+/g, '');
  return NORMAL_NON_ATTRACTION_TEXT_RE.test(rawText.trim())
    || NORMAL_NON_ATTRACTION_TEXT_RE.test(cleaned)
    || NORMAL_NON_ATTRACTION_TEXT_RE.test(compact)
    || NON_ATTRACTION_CANDIDATE_RE.test(compact)
    || NON_ATTRACTION_TEXT_RE.test(rawText)
    || NON_ATTRACTION_TEXT_RE.test(cleaned)
    || NON_ATTRACTION_TEXT_RE.test(compact);
}

function isDestinationScopedNonAttractionCandidate(rawText: string, destination?: string | null): boolean {
  const compactDestination = String(destination ?? '').replace(/\s+/g, '');
  if (!compactDestination.includes('\uC11C\uC548')) return false;

  const cleaned = normalizedAttractionCandidate(rawText);
  const compact = cleaned.replace(/\s+/g, '');
  return /^(?:\(?\uC11C\uC548\uBA74\uC694\uB9AC\)?|\uAD50\uC790\uC5F0|\uAE08\uC0AC\uAD00)$/.test(compact)
    || /^[\u25B6\u25CF\u2022\u00B7\u25C6\u25C7\u25A0\u25A1\u2605\u2606+\-\u2663\u220E\u203B]*\uC11C\uC548\uC758\uC720\uBA85\uD55C\uC628\uCC9C\uC9C0/.test(compact);
}

function extractAttractionCandidateLabels(rawText: string): string[] {
  const candidates: string[] = [];
  pushCandidate(candidates, rawText);
  const cleaned = normalizedAttractionCandidate(rawText);

  for (const [pattern, label] of DESCRIPTION_LABEL_RULES) {
    if (pattern.test(rawText) || pattern.test(cleaned)) pushCandidate(candidates, label);
  }

  for (const part of cleaned.split(/\s*(?:,|\uff0c|\/|\u318d|\u00b7|\ubc0f|\u0026)\s*/)) {
    pushCandidate(candidates, part);
  }

  const beforeParen = rawText.match(/([A-Za-z0-9\uac00-\ud7a3][A-Za-z0-9\uac00-\ud7a3\s]{1,20})\s*\([^)]{1,20}\)/);
  pushCandidate(candidates, beforeParen?.[1]);

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  pushCandidate(candidates, tokens.at(-1));
  for (let size = 2; size <= 3; size++) {
    if (tokens.length >= size) pushCandidate(candidates, tokens.slice(-size).join(' '));
  }

  return candidates;
}

const DESTINATION_SCOPE_HINT_STOP_WORDS = new Set([
  'day',
  'include',
  'exclude',
  'pkg',
  '\uc77c\uc815',
  '\uad00\uad11',
  '\ubc29\ubb38',
  '\uc870\uc2dd',
  '\uc911\uc2dd',
  '\uc11d\uc2dd',
  '\ud638\ud154',
  '\uacf5\ud56d',
]);

function compactAttractionText(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function pushScopeHint(scopes: string[], value: string | null | undefined, currentDestination?: string): void {
  const normalized = normalizedAttractionCandidate(value ?? '');
  const compact = compactAttractionText(normalized);
  if (compact.length < 2 || compact.length > 16) return;
  if (compact === compactAttractionText(currentDestination)) return;
  if (DESTINATION_SCOPE_HINT_STOP_WORDS.has(compact)) return;
  if (!/[A-Za-z\uac00-\ud7a3]/.test(normalized)) return;
  if (!scopes.some(scope => compactAttractionText(scope) === compact)) scopes.push(normalized);
}

function extractDestinationScopeHints(
  rawText: string,
  candidate: string,
  currentDestination?: string,
): string[] {
  const cleaned = normalizedAttractionCandidate(rawText);
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const candidateTokens = normalizedAttractionCandidate(candidate).split(/\s+/).filter(Boolean);
  if (tokens.length <= candidateTokens.length || candidateTokens.length === 0) return [];

  const tail = tokens.slice(-candidateTokens.length).join('');
  if (tail !== candidateTokens.join('')) return [];

  const prefixTokens = tokens.slice(0, -candidateTokens.length);
  if (prefixTokens.length === 0 || prefixTokens.length > 2) return [];

  const scopes: string[] = [];
  pushScopeHint(scopes, prefixTokens.join(' '), currentDestination);
  for (const token of prefixTokens) pushScopeHint(scopes, token, currentDestination);
  return scopes;
}

const STRUCTURAL_NON_ATTRACTION_COMPACT = new Set([
  '\ub610\ub294',
  '\uc815\uc2dd',
  '\uc77c\uc815',
  '\uad00\uad11',
  '\ud2b9\uc804',
]);

function isStructuralNonAttractionCandidate(rawText: string): boolean {
  const cleaned = normalizedAttractionCandidate(rawText);
  const compact = compactAttractionText(cleaned);
  if (STRUCTURAL_NON_ATTRACTION_COMPACT.has(compact)) return true;
  if (/^\u2605?\ud2b9\uc804\d*\u2605?/.test(compact)) return true;
  if (compact.includes('\ud2b9\uc804') && (compact.includes('\uc81c\uacf5') || compact.includes('\ub3c4\uc2dc\ub77d') || compact.includes('\ud558\uc774\ud2f0'))) return true;
  return false;
}

function attractionScopeTokens(attraction: AttractionData): string[] {
  return String(attraction.region ?? '')
    .split(/[,/|&\u00b7\u318d\uBC0F\s]+/)
    .map(token => normalizedAttractionCandidate(token))
    .filter(token => compactAttractionText(token).length >= 2);
}

function isStandaloneKnownDestinationScope(
  rawText: string,
  attractions: AttractionData[],
): boolean {
  const cleaned = normalizedAttractionCandidate(rawText);
  const compact = compactAttractionText(cleaned);
  if (compact.length < 2 || compact.length > 16) return false;
  if (/\s/.test(cleaned) || /\d/.test(cleaned)) return false;
  if (STRUCTURAL_NON_ATTRACTION_COMPACT.has(compact)) return false;
  return attractions.some(attraction =>
    attractionScopeTokens(attraction).some(token => compactAttractionText(token) === compact),
  );
}

export function applyProductRegistrationV3Matching(
  ledger: V3DraftLedger,
  attractions: AttractionData[] = [],
  destination?: string | null,
): { ledger: V3DraftLedger; matchSummary: V3MatchSummary } {
  const next = cloneLedger(ledger);
  const unmatched: V3MatchSummary['unmatched'] = [];
  let attractionMatched = 0;
  let attractionUnmatched = 0;
  let optionReview = 0;
  let shoppingCount = 0;

  for (const variant of next.variants) {
    const variantHasAutoCleanOptionalDisclosure = variant.structured_facts.some(fact =>
      fact.category === 'optional_tour'
      && fact.review_status === 'auto_clean'
    ) || variant.standard_notices.some(notice =>
      notice.category === 'optional_tour'
      && notice.review_status === 'auto_clean'
    );
    const destinationScopesByDay = new Map<number, string[]>();
    for (const day of variant.days) {
      const dayDestinationScopes = destinationScopesByDay.get(day.day) ?? [];
      if (!destinationScopesByDay.has(day.day)) destinationScopesByDay.set(day.day, dayDestinationScopes);
      for (const event of day.events) {
        if (event.type === 'shopping') shoppingCount++;
        if (event.type === 'option' && !variantHasAutoCleanOptionalDisclosure) optionReview++;
        if (event.type !== 'attraction') continue;

        if (event.canonical_id && event.match_status === 'matched') {
          event.canonical_type = event.canonical_type ?? 'attraction';
          attractionMatched++;
          continue;
        }

        if (
          isStructuralNonAttractionCandidate(event.raw_text)
          || isNonAttractionCandidate(event.raw_text)
          || isDestinationScopedNonAttractionCandidate(event.raw_text, destination)
        ) {
          event.type = 'notice';
          event.canonical_type = null;
          event.match_status = 'ignored';
          continue;
        }

        const scopedDestination = destination?.trim() || undefined;
        let match: AttractionData | null = null;
        for (const candidate of extractAttractionCandidateLabels(event.raw_text)) {
          const destinationScopes = [
            scopedDestination,
            ...dayDestinationScopes,
            ...extractDestinationScopeHints(event.raw_text, candidate, scopedDestination),
          ].filter((scope, index, scopes): scope is string | undefined =>
            index === scopes.findIndex(other => compactAttractionText(other) === compactAttractionText(scope)),
          );
          for (const scope of destinationScopes) {
            match = matchAttraction(candidate, attractions, scope);
            if (match) break;
          }
          if (!match && (!scopedDestination || DESCRIPTION_LABEL_FALLBACKS.has(candidate.replace(/\s+/g, '')))) {
            match = matchAttraction(candidate, attractions, undefined);
          }
          if (match) break;
        }
        if (match?.id || match?.name) {
          event.canonical_id = match.id ?? match.name;
          event.canonical_type = 'attraction';
          event.match_status = 'matched';
          attractionMatched++;
        } else if (isStandaloneKnownDestinationScope(event.raw_text, attractions)) {
          pushScopeHint(dayDestinationScopes, event.raw_text, scopedDestination);
          event.type = 'notice';
          event.canonical_type = null;
          event.match_status = 'ignored';
        } else {
          event.match_status = 'unmatched';
          attractionUnmatched++;
          unmatched.push({
            raw_text: event.raw_text,
            day_number: day.day,
            evidence: event.evidence,
          });
        }
      }
    }
  }

  const entitySummary = buildV3EntitySummary({
    ledger: next,
    destination,
  });

  return {
    ledger: next,
    matchSummary: {
      attraction_matched_count: attractionMatched,
      attraction_unmatched_count: attractionUnmatched,
      option_review_count: Math.max(optionReview, entitySummary.option_review_needed_count),
      shopping_count: Math.max(shoppingCount, entitySummary.shopping_review_needed_count),
      unmatched,
      entity_summary: entitySummary,
    },
  };
}
