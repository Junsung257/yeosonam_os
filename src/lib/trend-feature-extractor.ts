/**
 * Trend Feature Extractor — 외부 트렌드 본문에서 피처 추출 (PR-2)
 *
 * 입력: Threads/IG 본문 텍스트
 * 출력: hook_first_line, hook_words, hashtag_count, emoji_count, hook_type 후보
 *
 * 룰 기반 분류기 — LLM 호출 없이 빠른 일차 분류.
 * (정밀 hook_type 라벨링은 별도 Gemini Flash 호출로 수행 — 비용 회피)
 */

import { countWordsForThreadsHook } from './card-news/tokens';

export interface ExtractedTrendFeatures {
  hook_first_line: string;
  hook_words: number;
  hashtag_count: number;
  emoji_count: number;
  has_question_mark: boolean;
  has_number: boolean;
  hook_type_guess: HookTypeGuess | null;
}

export type HookTypeGuess =
  | 'urgency'
  | 'question'
  | 'number'
  | 'fomo'
  | 'story'
  | 'contrarian'
  | 'gap'
  | 'data_story';

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const NUMBER_RE = /\d+/;

const URGENCY_HINTS = [
  /오늘\s*만/, /선착순/, /D-?\d+/, /마감/, /\d+\s*시간\s*후/, /last\s+chance/i, /limited/i,
];
const FOMO_HINTS = [
  /이번\s*주\s*만/, /한정/, /sold\s*out/i, /\d+\s*명?\s*남/, /놓치면/, /놓치/,
];
const STORY_HINTS = [
  /^(작년|3년\s*전|어느\s*날|진짜로|솔직히)/, /울었/, /후회/, /비밀/, /^I\b/,
];
const CONTRARIAN_HINTS = [
  /거짓말/, /뻥/, /\b아닙니다\b/, /실제로는/, /사실은/, /의외로/, /현지인은/, /\bnobody\b.*\btells\b/i,
];
const DATA_STORY_HINTS = [
  /\+\s*\d+\s*%/, /\-\s*\d+\s*%/, /검색량/, /상승/, /\d+\s*배/, /\d+x/i,
];
const GAP_HINTS = [
  /^아무도\s*안/, /숨겨진/, /\bsecret\b/i, /몰랐/, /놀라운/,
];

export function extractTrendFeatures(text: string): ExtractedTrendFeatures {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return {
      hook_first_line: '',
      hook_words: 0,
      hashtag_count: 0,
      emoji_count: 0,
      has_question_mark: false,
      has_number: false,
      hook_type_guess: null,
    };
  }

  // 첫 문장: 마침표/줄바꿈/느낌표/물음표/이모지로 구분
  const firstLine = (trimmed.split(/[.!?\n]/)[0] ?? trimmed).trim().slice(0, 200);
  const hookWords = countWordsForThreadsHook(firstLine);
  const hashtagCount = (trimmed.match(HASHTAG_RE) ?? []).length;
  const emojiCount = (trimmed.match(EMOJI_RE) ?? []).length;
  const hasQ = /\?/.test(firstLine);
  const hasNum = NUMBER_RE.test(firstLine);

  const guess = guessHookType({
    firstLine,
    hashtagCount,
    hasQ,
    hasNum,
  });

  return {
    hook_first_line: firstLine,
    hook_words: hookWords,
    hashtag_count: hashtagCount,
    emoji_count: emojiCount,
    has_question_mark: hasQ,
    has_number: hasNum,
    hook_type_guess: guess,
  };
}

function guessHookType(args: {
  firstLine: string;
  hashtagCount: number;
  hasQ: boolean;
  hasNum: boolean;
}): HookTypeGuess | null {
  const { firstLine, hasQ, hasNum } = args;

  if (URGENCY_HINTS.some((re) => re.test(firstLine))) return 'urgency';
  if (FOMO_HINTS.some((re) => re.test(firstLine))) return 'fomo';
  if (CONTRARIAN_HINTS.some((re) => re.test(firstLine))) return 'contrarian';
  if (DATA_STORY_HINTS.some((re) => re.test(firstLine))) return 'data_story';
  if (GAP_HINTS.some((re) => re.test(firstLine))) return 'gap';
  if (STORY_HINTS.some((re) => re.test(firstLine))) return 'story';
  if (hasQ) return 'question';
  if (hasNum) return 'number';
  return null;
}

/**
 * 본문에서 PII 추정 정보 제거 (PIPA 가드).
 *   - 010-XXXX-XXXX 전화번호
 *   - email@domain
 *   - @username 멘션 (Threads/IG)
 * 자동 marshalling — DB 저장 전 호출.
 */
export function scrubPII(text: string): { scrubbed: string; piiDetected: boolean } {
  if (!text) return { scrubbed: '', piiDetected: false };
  let result = text;
  let detected = false;

  const phone = /\b01[016789][- .]?\d{3,4}[- .]?\d{4}\b/g;
  if (phone.test(result)) detected = true;
  result = result.replace(phone, '[전화]');

  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  if (email.test(result)) detected = true;
  result = result.replace(email, '[email]');

  const mention = /@[A-Za-z0-9_.]{2,30}/g;
  if (mention.test(result)) detected = true;
  result = result.replace(mention, '@[user]');

  return { scrubbed: result, piiDetected: detected };
}
