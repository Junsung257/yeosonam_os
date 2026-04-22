/**
 * 여소남 OS — SSE 이벤트 인코더 (V2 §B.1)
 *
 * `/api/jarvis/stream` 엔드포인트가 AsyncGenerator 에서 나오는 StreamEvent 를
 * 브라우저 EventSource 가 파싱 가능한 SSE 포맷으로 변환한다.
 *
 * SSE 포맷:
 *   event: <type>
 *   data: <json>
 *   [빈 줄]
 */

export type StreamEventType =
  | 'text_delta'      // 토큰 단위 answer 청크
  | 'tool_use_start'  // tool 호출 시작 — UI 에서 "예약 조회 중..." 표시
  | 'tool_result'     // tool 결과 (요약) — UI 에서 "3건 찾음" 표시
  | 'hitl_pending'    // HITL 승인 대기 — UI 에서 승인 모달 띄움
  | 'agent_picked'    // Router 결정 결과
  | 'cache_hit'       // 캐시 hit 여부 — latency 디버깅용
  | 'done'            // 정상 종료
  | 'error'           // 에러 종료

export interface StreamEvent {
  type: StreamEventType
  data: unknown
}

const encoder = new TextEncoder()

export function encodeSSE(event: StreamEvent): Uint8Array {
  // data 안의 개행은 "\n"이 아니라 "\ndata: "로 이스케이프 해야 스펙 준수
  const payload = JSON.stringify(event.data).replace(/\n/g, '\\n')
  return encoder.encode(`event: ${event.type}\ndata: ${payload}\n\n`)
}

/** keepalive 용 주석 프레임 — 프록시/브라우저 timeout 방어 (15초마다 권장) */
export function encodeKeepalive(): Uint8Array {
  return encoder.encode(`: keepalive ${Date.now()}\n\n`)
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // Nginx/Vercel edge buffering 방지
}
