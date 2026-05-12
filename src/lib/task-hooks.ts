/**
 * Task / Inbox Federation Hooks
 *
 * 사장님이 booking_tasks (bookings 도메인) 과 별개로, 카드뉴스 재작성·콘텐츠 DRAFT
 * 같은 "관리자 처리 대기" 이벤트도 같은 Inbox UI 에서 보이게 federation.
 *
 * 배경:
 *   - /admin/inbox 는 booking_tasks 도메인 소유 (사장님 설계)
 *   - 카드뉴스 refinement, 저성과 검수 등은 별도 큐가 되면 Inbox 파편화
 *   - 본 모듈이 "이벤트 발행" 만 담당. 실제 저장은 booking_tasks 스키마 확정 후 구현
 *
 * 현재 상태: NO-OP. 사장님 booking_tasks 완성 후 insertContentTask() 본문만 채우면 됨.
 *
 * 사용 예 (card-news-refine 크론 등):
 *   await onContentRefinementCreated({
 *     card_news_id: 'xxx',
 *     refined_from_id: 'yyy',
 *     reason: 'low_performance_score',
 *     original_score: 0.15,
 *   });
 */
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

export interface ContentRefinementEvent {
  card_news_id: string;
  refined_from_id: string;
  reason: 'low_performance_score' | 'manual_request' | 'engagement_decline';
  original_score?: number;
  chosen_angle?: string;
}

export interface ContentDraftReadyEvent {
  card_news_id: string;
  status: 'DRAFT';
  package_id?: string | null;
  title: string;
  source: 'refine_cron' | 'manual_create' | 'create_variant';
}

/**
 * card-news-refine 크론이 저성과 카드뉴스의 재작성본을 만들 때 호출.
 * sloppy failure: booking_tasks 에 insert 실패해도 refine 자체는 성공 유지.
 */
export async function onContentRefinementCreated(event: ContentRefinementEvent): Promise<void> {
  // 1. 영구 이벤트 로그 (항상 기록 — booking_tasks 미준비여도 흐름 추적 가능)
  if (isSupabaseConfigured) {
    try {
      await supabaseAdmin.from('cron_run_logs').insert({
        cron_name: '_event:content_refinement',
        status: 'success',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        elapsed_ms: 0,
        summary: event as never,
        error_count: 0,
        error_messages: [],
        alerted: false,
      } as never);
    } catch { /* noop */ }
  }

  // 2. booking_tasks federation (사장님 booking_tasks 스키마 확정 후 구현)
  //    예상 호출 시그니처:
  //    await supabaseAdmin.from('booking_tasks').insert({
  //      task_type: 'content_refinement_review',
  //      ref_table: 'card_news',
  //      ref_id: event.card_news_id,
  //      priority: event.original_score !== undefined && event.original_score < 0.15 ? 'high' : 'normal',
  //      fingerprint: `content_refinement:${event.card_news_id}`,
  //      cooldown_hours: 168,  // 같은 카드뉴스 1주일에 1회만
  //      payload: event,
  //    });
  //
  // 현재는 no-op. 사장님이 booking_tasks 준비되면 위 예시 주석을 활성화.
}

/**
 * 신규 카드뉴스가 DRAFT 상태로 저장될 때 호출 (create-variant, manual 생성 등).
 * CONFIRMED 로 승격되기 전 사장님 검수 필요한 경우 Inbox 에 표시.
 */
export async function onContentDraftReady(_event: ContentDraftReadyEvent): Promise<void> {
  // NO-OP. booking_tasks 확정 후 구현.
  //
  // 예상:
  //   await supabaseAdmin.from('booking_tasks').insert({
  //     task_type: 'content_draft_review',
  //     ref_table: 'card_news',
  //     ref_id: event.card_news_id,
  //     fingerprint: `content_draft:${event.card_news_id}`,
  //     cooldown_hours: 720, // 30일 (같은 draft 반복 알림 방지)
  //     payload: event,
  //   });
}

/**
 * 카드뉴스가 CONFIRMED → LAUNCHED 등으로 전이해 해당 Inbox task 가 의미 없어졌을 때.
 * 사장님 booking_tasks 의 "supersede" 패턴에 따라 원본 task 를 superseded 상태로.
 */
export async function onContentTaskSuperseded(_cardNewsId: string, _reason: string): Promise<void> {
  // NO-OP. 구현 예상:
  //   await supabaseAdmin
  //     .from('booking_tasks')
  //     .update({ status: 'superseded', superseded_reason: reason })
  //     .eq('ref_table', 'card_news')
  //     .eq('ref_id', cardNewsId)
  //     .eq('status', 'open');
}
