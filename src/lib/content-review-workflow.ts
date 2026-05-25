import { supabaseAdmin } from '@/lib/supabase';
import { sendReviewNotification } from './content-review-notify';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ReviewStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'changes_requested';

export type RejectionCategory =
  | 'quality_low'
  | 'fact_error'
  | 'seo_issue'
  | 'brand_violation'
  | 'duplicate'
  | 'inappropriate_tone'
  | 'legal_issue'
  | 'other';

export type QueueReason =
  | 'new_content'
  | 're_resubmit'
  | 'auto_generated'
  | 'high_traffic_update'
  | 'scheduled_publish';

export interface ReviewDecision {
  creativeId: string;
  reviewerId: string;
  status: 'approved' | 'rejected' | 'changes_requested';
  reviewNote?: string;
  rejectionReason?: string;
  rejectionCategory?: RejectionCategory;
  suggestedChanges?: string;
}

export interface QueueItem {
  creativeId: string;
  priority?: number;
  reason?: QueueReason;
  dueAt?: string;
  autoApproveAfterHours?: number;
}

export interface ReviewHistoryEntry {
  round: number;
  status: string;
  reviewerId: string;
  reviewedAt: string;
  note: string;
  rejectionCategory: string;
}

export interface PendingReviewItem {
  queueId: string;
  creativeId: string;
  title: string;
  channel: string;
  priority: number;
  reason: string;
  queuedAt: string;
  dueAt: string | null;
}

// ─── Queue ─────────────────────────────────────────────────────────────────────

/** 콘텐츠를 검토 큐에 등록한다 */
export async function queueForReview(item: QueueItem): Promise<{ queueId: string }> {
  const { data, error } = await supabaseAdmin
    .from('content_review_queue')
    .insert({
      creative_id: item.creativeId,
      priority: item.priority ?? 50,
      reason: item.reason ?? 'new_content',
      due_at: item.dueAt ?? null,
      auto_approve_after_hours: item.autoApproveAfterHours ?? 48,
    })
    .select('id')
    .single();

  if (error) throw new Error(`큐 등록 실패: ${error.message}`);

  // content_creatives.review_status 를 'pending_review' 로 변경 (draft 인 경우만)
  await supabaseAdmin
    .from('content_creatives')
    .update({ review_status: 'pending_review' })
    .eq('id', item.creativeId)
    .in('status', ['draft', 'pending']);

  return { queueId: (data as { id: string }).id };
}

// ─── Assign ────────────────────────────────────────────────────────────────────

/** 가장 덜 바쁜 리뷰어를 찾아 검토를 할당한다 */
export async function assignReviewer(
  queueId: string,
): Promise<{ reviewerId: string }> {
  // 1) 큐 아이템 조회
  const { data: queueItem, error: queueError } = await supabaseAdmin
    .from('content_review_queue')
    .select('creative_id, priority')
    .eq('id', queueId)
    .single();

  if (queueError || !queueItem) throw new Error('큐 아이템을 찾을 수 없습니다');

  // 2) postgrest 를 사용할 수 없는 환경이므로 admin_users 에서 가장 덜 바쁜 리뷰어를 직접 찾는다
  const reviewerId = await pickLeastLoadedReviewer();

  // 3) content_reviews 레코드 생성
  const { data: review, error: insertError } = await supabaseAdmin
    .from('content_reviews')
    .insert({
      creative_id: queueItem.creative_id,
      reviewer_id: reviewerId,
      status: 'in_review',
      review_round: 1,
    })
    .select('id')
    .single();

  if (insertError) throw new Error(`검토 할당 실패: ${insertError.message}`);

  // 4) 큐 상태 업데이트
  await supabaseAdmin
    .from('content_review_queue')
    .update({ status: 'assigned', assigned_to: reviewerId })
    .eq('id', queueId);

  // 5) content_creatives.review_status 업데이트
  await supabaseAdmin
    .from('content_creatives')
    .update({ review_status: 'in_review' })
    .eq('id', queueItem.creative_id);

  return { reviewerId };
}

/** admin_users 테이블에서 pending 건수가 가장 적은 리뷰어를 반환한다 */
async function pickLeastLoadedReviewer(): Promise<string> {
  // 우선 admin_users 중 reviewer 역할이 있는 사용자 목록을 가져온다
  const { data: admins, error: adminsError } = await supabaseAdmin
    .from('admin_users')
    .select('id');

  if (adminsError || !admins || admins.length === 0) {
    // fallback: admin_users 가 없으면 content_reviews 에 reviewer_id 가 없는 레코드가 있다면
    // reviewer_id 를 직접 할당할 수 없으므로, 알 수 없는 경우 에러
    throw new Error('할당 가능한 리뷰어가 없습니다');
  }

  const adminIds = admins.map((a: { id: string }) => a.id);

  // 각 리뷰어의 pending 건수를 센다
  const { data: loads, error: loadsError } = await supabaseAdmin
    .from('content_reviews')
    .select('reviewer_id, count')
    .in('reviewer_id', adminIds)
    .in('status', ['pending', 'in_review'])
    .limit(1000);

  if (loadsError) {
    // 통계 조회 실패 시 첫 번째 admin 을 반환
    return adminIds[0];
  }

  const loadMap = new Map<string, number>();
  for (const r of loads || []) {
    const row = r as { reviewer_id: string; count: number };
    loadMap.set(row.reviewer_id, (loadMap.get(row.reviewer_id) ?? 0) + 1);
  }

  // 가장 덜 바쁜 리뷰어 선택
  let minLoad = Infinity;
  let selected = adminIds[0];
  for (const id of adminIds) {
    const load = loadMap.get(id) ?? 0;
    if (load < minLoad) {
      minLoad = load;
      selected = id;
    }
  }

  return selected;
}

// ─── Submit Decision ───────────────────────────────────────────────────────────

/** 리뷰 결정을 제출하고 content_creatives 상태를 갱신한다 */
export async function submitReview(
  decision: ReviewDecision,
): Promise<{ reviewId: string }> {
  // 1) 진행 중인 review 조회 (가장 최근 in_review 레코드)
  const { data: activeReview, error: findError } = await supabaseAdmin
    .from('content_reviews')
    .select('id, review_round')
    .eq('creative_id', decision.creativeId)
    .eq('status', 'in_review')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(`검토 레코드 조회 실패: ${findError.message}`);

  const now = new Date().toISOString();

  if (activeReview) {
    // 기존 review 업데이트
    const { error: updateError } = await supabaseAdmin
      .from('content_reviews')
      .update({
        status: decision.status,
        review_note: decision.reviewNote ?? null,
        rejection_reason: decision.rejectionReason ?? null,
        rejection_category: decision.rejectionCategory ?? null,
        suggested_changes: decision.suggestedChanges ?? null,
        reviewed_at: now,
        completed_at: now,
      })
      .eq('id', (activeReview as { id: string }).id);

    if (updateError) throw new Error(`검토 업데이트 실패: ${updateError.message}`);
  }

  // 2) content_creatives 상태 변경
  const creativeUpdate: Record<string, string> = {};

  switch (decision.status) {
    case 'approved':
      creativeUpdate.review_status = 'approved';
      break;
    case 'rejected':
      creativeUpdate.review_status = 'rejected';
      break;
    case 'changes_requested': {
      creativeUpdate.review_status = 'changes_requested';
      break;
    }
  }

  if (Object.keys(creativeUpdate).length > 0) {
    await supabaseAdmin
      .from('content_creatives')
      .update(creativeUpdate)
      .eq('id', decision.creativeId);
  }

  // 3) changes_requested → 새 리뷰 라운드 생성
  if (decision.status === 'changes_requested') {
    const newRound = (activeReview as { review_round?: number } | null)?.review_round ?? 1;
    await supabaseAdmin.from('content_reviews').insert({
      creative_id: decision.creativeId,
      reviewer_id: decision.reviewerId,
      status: 'pending',
      review_round: newRound + 1,
      previous_review_id: activeReview
        ? (activeReview as { id: string }).id
        : null,
    });
  }

  // 4) 큐 아이템 완료 처리
  await supabaseAdmin
    .from('content_review_queue')
    .update({ status: 'completed' })
    .eq('creative_id', decision.creativeId)
    .in('status', ['queued', 'assigned']);

  // Send Slack notification (non-blocking)
  sendReviewNotification({
    creativeId: decision.creativeId,
    eventType: decision.status,
    reviewerId: decision.reviewerId,
    reviewNote: decision.reviewNote,
  }).catch((err) => console.warn('[content-review-workflow] Slack 알림 실패:', err));

  return { reviewId: activeReview ? (activeReview as { id: string }).id : 'new' };
}

// ─── Auto-Approve Stale Items ──────────────────────────────────────────────────

/** 낮은 우선순위(priority < 30) 큐 아이템 중 auto_approve_after_hours 가 지난 항목을 자동 승인한다 */
export async function autoApproveStaleItems(): Promise<{
  approved: number;
  still_pending: number;
}> {
  const { data: staleItems, error } = await supabaseAdmin
    .from('content_review_queue')
    .select('id, creative_id, priority')
    .eq('status', 'queued')
    .lt('priority', 30)
    .lt(
      'created_at',
      new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    );

  if (error) throw new Error(`만료 큐 조회 실패: ${error.message}`);

  let approved = 0;

  for (const item of (staleItems || []) as Array<{
    id: string;
    creative_id: string;
    priority: number;
  }>) {
    // 자동 승인 review 레코드 생성
    await supabaseAdmin.from('content_reviews').insert({
      creative_id: item.creative_id,
      reviewer_id: null,
      status: 'approved',
      review_note: '자동 승인 (저우선순위, 시간 초과)',
      review_round: 1,
      reviewed_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    // content_creatives 상태 업데이트
    await supabaseAdmin
      .from('content_creatives')
      .update({ review_status: 'approved' })
      .eq('id', item.creative_id);

    // 큐 완료 처리
    await supabaseAdmin
      .from('content_review_queue')
      .update({ status: 'auto_approved' })
      .eq('id', item.id);

    // Slack 알림 (자동 승인)
    const hoursElapsed = 48;
    await sendReviewNotification({
      creativeId: item.creative_id,
      eventType: 'approved',
      reviewNote: `${hoursElapsed}시간 경과 자동 승인`,
    }).catch((err) => console.warn('[content-review-workflow] Slack 자동승인 알림 실패:', err));

    approved++;
  }

  // 아직 대기 중인 큐 아이템 수
  const { count: stillPending } = await supabaseAdmin
    .from('content_review_queue')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'assigned']);

  return { approved, still_pending: stillPending ?? 0 };
}

// ─── Review History ────────────────────────────────────────────────────────────

/** 특정 creative 의 전체 검토 이력을 조회한다 */
export async function getReviewHistory(
  creativeId: string,
): Promise<ReviewHistoryEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('content_reviews')
    .select(
      'review_round, status, reviewer_id, reviewed_at, review_note, rejection_category',
    )
    .eq('creative_id', creativeId)
    .order('review_round', { ascending: true });

  if (error) throw new Error(`검토 이력 조회 실패: ${error.message}`);

  return ((data as Array<{
    review_round: number;
    status: string;
    reviewer_id: string;
    reviewed_at: string;
    review_note: string;
    rejection_category: string;
  }>) || []).map((r) => ({
    round: r.review_round,
    status: r.status,
    reviewerId: r.reviewer_id,
    reviewedAt: r.reviewed_at ?? '',
    note: r.review_note ?? '',
    rejectionCategory: r.rejection_category ?? '',
  }));
}

// ─── Pending Reviews ───────────────────────────────────────────────────────────

/** 어드민 UI 용 대기 중인 리뷰 목록을 조회한다 */
export async function getPendingReviews(
  opts?: { limit?: number; priorityMin?: number },
): Promise<PendingReviewItem[]> {
  const limit = opts?.limit ?? 50;
  const priorityMin = opts?.priorityMin ?? 1;

  const query = supabaseAdmin
    .from('content_review_queue')
    .select(
      `
      id,
      creative_id,
      priority,
      reason,
      created_at,
      due_at,
      content_creatives!inner(title, status)
    `,
    )
    .in('status', ['queued', 'assigned'])
    .gte('priority', priorityMin)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  const { data, error } = await query;

  if (error) throw new Error(`대기 큐 조회 실패: ${error.message}`);

  return ((data as Array<{
    id: string;
    creative_id: string;
    priority: number;
    reason: string;
    created_at: string;
    due_at: string | null;
    content_creatives: { title: string; status: string };
  }>) || []).map((r) => ({
    queueId: r.id,
    creativeId: r.creative_id,
    title: r.content_creatives?.title ?? '(제목 없음)',
    channel: r.content_creatives?.status ?? '',
    priority: r.priority,
    reason: r.reason,
    queuedAt: r.created_at,
    dueAt: r.due_at,
  }));
}

// ─── Reviewer Load ─────────────────────────────────────────────────────────────

/** 각 리뷰어의 현재 pending 건수를 반환한다 */
export async function getReviewerLoads(): Promise<
  Array<{ reviewerId: string; pending: number }>
> {
  const { data: admins } = await supabaseAdmin
    .from('admin_users')
    .select('id');

  if (!admins || admins.length === 0) return [];

  const adminIds = admins.map((a: { id: string }) => a.id);
  const result: Array<{ reviewerId: string; pending: number }> = [];

  for (const id of adminIds) {
    const { count, error } = await supabaseAdmin
      .from('content_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('reviewer_id', id)
      .in('status', ['pending', 'in_review']);

    if (!error) {
      result.push({ reviewerId: id, pending: count ?? 0 });
    }
  }

  return result.sort((a, b) => a.pending - b.pending);
}
