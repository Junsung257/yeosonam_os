import type { ChatMessage } from '@/lib/chat-store';

const QA_HISTORY_MAX_CHARS = 1200;

/** /api/qa/chat 에 넘길 대화 요약 — 빈 본문·카드형 메시지는 짧은 설명으로 대체, 토큰 과다 방지 */
export function buildQaChatHistory(
  messages: ChatMessage[],
  maxTurns = 10,
): { role: string; content: string }[] {
  return messages.slice(-maxTurns).map((m) => {
    let text = (m.content ?? '').trim();
    if (m.role === 'assistant' && !text) {
      if (m.type === 'product_cards' && m.products?.length) {
        text = `[상담원이 상품 ${m.products.length}건을 카드로 안내했습니다]`;
      } else if (m.type === 'cta_links') {
        text = '[자유여행 견적 페이지로 안내했습니다]';
      } else if (m.type === 'buttons') {
        text = '[상담원이 선택 버튼을 제시했습니다]';
      } else {
        text = '(응답 없음)';
      }
    }
    if (text.length > QA_HISTORY_MAX_CHARS) {
      text = text.slice(0, QA_HISTORY_MAX_CHARS) + '…';
    }
    return { role: m.role, content: text };
  });
}
