/**
 * Kakao 채팅 export 텍스트 파서.
 *
 * 입력 예시 (PC/모바일 export 공통 모티프):
 *   2026.03.08 일요일
 *   여소남님이 보냄 보낸 메시지 가이드
 *   '여소남' 입니다. 궁금한 내용이 있으면 ...
 *   오후06:30
 *   프로필 사진
 *   주&준&로이
 *   안녕하세요. 5월14일 치앙마이 ...
 *   오후06:31
 *
 * 목표: (sender, timestamp_iso, text) 메시지 배열로 변환.
 *       정밀도가 중요하지 않음 — LLM 추출기에 메시지 단위 컨텍스트만 주는 용도.
 */

export interface KakaoMessage {
  index: number;
  sender: string;
  timestamp_iso: string | null;
  date_iso: string | null;
  text: string;
}

const DATE_RE = /^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*(?:[월화수목금토일]요일)?$/;
const TIME_RE = /^오(전|후)\s*(\d{1,2}):(\d{2})$/;
const SENDER_HINT_RE = /^([\S][^\n]{0,30})님이 보냄/;
const SKIP_LINES = new Set([
  '프로필 사진', '사진저장하기', '저장하기', '이미지묶음', '전체보기',
  '하단 이동', '메시지 보내기', '선택된 파일 없음', '전송', '채널 추가',
  '보낸 메시지 가이드', '받은 메시지 가이드',
]);

function parseTimeOnDate(date_iso: string, raw: string): string | null {
  const m = raw.match(TIME_RE);
  if (!m) return null;
  const ampm = m[1];
  let hh = parseInt(m[2], 10);
  const mm = parseInt(m[3], 10);
  if (ampm === '후' && hh < 12) hh += 12;
  if (ampm === '전' && hh === 12) hh = 0;
  return `${date_iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`;
}

function parseDate(raw: string): string | null {
  const m = raw.match(DATE_RE);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

export function parseKakaoChat(input: string): KakaoMessage[] {
  const lines = input.split(/\r?\n/).map(l => l.trim());
  const messages: KakaoMessage[] = [];

  let currentDate: string | null = null;
  let currentSender = '고객';
  let pendingText: string[] = [];
  let pendingTimestamp: string | null = null;

  const flush = () => {
    if (pendingText.length === 0) return;
    const text = pendingText.join('\n').trim();
    if (text.length > 0) {
      messages.push({
        index: messages.length,
        sender: currentSender,
        timestamp_iso: pendingTimestamp,
        date_iso: currentDate,
        text,
      });
    }
    pendingText = [];
    pendingTimestamp = null;
  };

  for (const line of lines) {
    if (!line) continue;
    if (SKIP_LINES.has(line)) continue;

    const date = parseDate(line);
    if (date) { flush(); currentDate = date; continue; }

    if (currentDate) {
      const time = parseTimeOnDate(currentDate, line);
      if (time) {
        pendingTimestamp = time;
        flush();
        continue;
      }
    }

    const senderHint = line.match(SENDER_HINT_RE);
    if (senderHint) {
      flush();
      currentSender = senderHint[1].trim();
      continue;
    }

    if (/^[가-힣A-Za-z0-9 &.\-_]{1,20}$/.test(line) && !/[.!?\s가-힣]{6,}/.test(line) && line.length <= 12 && pendingText.length === 0) {
      currentSender = line;
      continue;
    }

    pendingText.push(line);
  }
  flush();

  return messages;
}

export function summarizeForExtraction(messages: KakaoMessage[]): string {
  return messages
    .map(m => `[${m.timestamp_iso ?? m.date_iso ?? '?'}] ${m.sender}: ${m.text}`)
    .join('\n');
}
