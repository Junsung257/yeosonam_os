'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext, DragOverlay, useSensor, useSensors, PointerSensor,
  useDraggable, useDroppable,
} from '@dnd-kit/core';
import ContentSubNav from '../content-hub/ContentSubNav';

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────
interface PlatformStatusMap {
  [key: string]: string | null;
}

interface CalendarItem {
  id: string;
  source: 'card_news' | 'distribution';
  title: string;
  status: string;
  type: 'affiliate' | 'platform';
  branding_level: string | null;
  platform_statuses: PlatformStatusMap;
  scheduled_for: string | null;
  scheduled_platform: string | null;
  created_at: string;
}

interface CalendarDay {
  date: string;
  total: number;
  draft: number;
  confirmed: number;
  published: number;
  archived: number;
  scheduled: number;
  affiliate: number;
  platform: number;
  items: CalendarItem[];
}

interface ScheduledEntry {
  id: string;
  source: 'card_news' | 'distribution';
  title: string;
  type: 'affiliate' | 'platform';
  scheduled_for: string;
  platform: string;
  status: string;
  branding_level: string | null;
}

interface CalendarData {
  year: number;
  month: number;
  totalCards: number;
  totalDistributions: number;
  days: CalendarDay[];
  scheduled: ScheduledEntry[];
}

// ─────────────────────────────────────────────
// 상태별 색상/라벨
// ─────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안',
  CONFIRMED: '확인',
  PUBLISHED: '발행',
  LAUNCHED: '발행',
  ARCHIVED: '보관',
  scheduled: '예약',
  published: '발행',
  draft: '초안',
  failed: '실패',
  queued: '대기',
  publishing: '발행중',
};

const STATUS_PILLS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-green-100 text-green-700',
  PUBLISHED: 'bg-purple-100 text-purple-700',
  LAUNCHED: 'bg-purple-100 text-purple-700',
  ARCHIVED: 'bg-yellow-100 text-yellow-700',
  scheduled: 'bg-blue-100 text-blue-700',
  published: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-700',
  queued: 'bg-amber-100 text-amber-700',
  publishing: 'bg-sky-100 text-sky-700',
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'IG',
  threads: 'Threads',
  twitter: 'X',
  x: 'X',
  facebook: 'FB',
  meta_ads: 'Meta Ads',
  blog_body: '블로그',
  naver_blog: '네이버',
  instagram_caption: 'IG',
  instagram_story: 'IG Story',
  threads_post: 'Threads',
  kakao_channel: '카카오',
  google_ads_rsa: 'Google',
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: 'bg-pink-500',
  threads: 'bg-purple-500',
  twitter: 'bg-sky-500',
  x: 'bg-sky-500',
  facebook: 'bg-blue-600',
  meta_ads: 'bg-blue-500',
  blog_body: 'bg-emerald-500',
  naver_blog: 'bg-green-500',
  instagram_caption: 'bg-pink-500',
  threads_post: 'bg-purple-500',
  kakao_channel: 'bg-yellow-500',
};

// ─────────────────────────────────────────────
// Draggable Item Wrapper
// ─────────────────────────────────────────────
function DraggableItem({
  item,
  compact,
}: {
  item: CalendarItem | ScheduledEntry;
  compact?: boolean;
}) {
  const itemId = `${item.source}-${item.id}`;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: itemId,
    data: { item },
  });
  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const platform =
    'platform' in item
      ? (item as ScheduledEntry).platform
      : (item as CalendarItem).scheduled_platform ?? '';

  const isPublished = item.status === 'PUBLISHED' || item.status === 'published' || item.status === 'LAUNCHED';

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      } ${
        isPublished ? 'bg-green-50 text-green-800' : 'bg-white border border-admin-border-mid'
      }`}
    >
      {/* 플랫폼 아이콘 */}
      {platform && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            PLATFORM_COLORS[platform] ?? 'bg-gray-400'
          }`}
        />
      )}
      <span className="truncate flex-1">{item.title}</span>
      {compact && (
        <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-medium ${STATUS_PILLS[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 정적 Item Display (드래그 불가, 이미 발행된 것)
// ─────────────────────────────────────────────
function StaticItem({
  item,
  platform,
}: {
  item: CalendarItem;
  platform?: string;
}) {
  const p = platform || item.scheduled_platform || '';
  return (
    <div className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] bg-green-50 text-green-800">
      {p && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            PLATFORM_COLORS[p] ?? 'bg-gray-400'
          }`}
        />
      )}
      <span className="truncate flex-1">{item.title}</span>
      <span className="text-green-600 shrink-0 font-medium">✓</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// Droppable Cell (날짜 셀)
// ─────────────────────────────────────────────
function DroppableCell({
  dateStr,
  day,
  isToday,
  isSelected,
  dow,
  onClick,
  scheduledItems,
}: {
  dateStr: string;
  day: number;
  isToday: boolean;
  isSelected: boolean;
  dow: number;
  onClick: () => void;
  scheduledItems: ScheduledEntry[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={`min-h-[110px] border-b border-r border-admin-border p-1.5 text-left transition-colors ${
        isSelected
          ? 'ring-2 ring-indigo-400 ring-inset bg-indigo-50/30'
          : isOver
            ? 'bg-indigo-100/60 ring-2 ring-indigo-300 ring-inset'
            : 'hover:bg-admin-bg'
      }`}
    >
      {/* 날짜 숫자 */}
      <div className="flex items-center justify-between mb-1">
        <span
          className={`text-xs font-medium ${
            isToday
              ? 'bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center'
              : dow === 0
                ? 'text-red-400'
                : dow === 6
                  ? 'text-blue-400'
                  : 'text-admin-muted'
          }`}
        >
          {isToday ? (
            <span className="flex items-center justify-center w-5 h-5">{day}</span>
          ) : (
            day
          )}
        </span>
        {scheduledItems.length > 0 && (
          <span className="text-[10px] text-admin-muted-2">{scheduledItems.length}</span>
        )}
      </div>

      {/* 예약된 아이템 */}
      <div className="space-y-0.5">
        {scheduledItems.slice(0, 3).map((si) => (
          <div key={`${si.source}-${si.id}`} className="flex items-center gap-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                PLATFORM_COLORS[si.platform] ?? 'bg-gray-400'
              }`}
            />
            <span className="text-[10px] text-admin-muted truncate flex-1">{si.title}</span>
          </div>
        ))}
        {scheduledItems.length > 3 && (
          <div className="text-[9px] text-admin-muted-2 pl-2">+{scheduledItems.length - 3}건</div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────
export function ContentCalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [rescheduling, setRescheduling] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      if (platformFilter) params.set('platform', platformFilter);
      const res = await fetch(`/api/content-calendar?${params}`);
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [year, month, platformFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // 달력 그리드 계산
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  // 예약 맵: 날짜 문자열 → ScheduledEntry[]
  const scheduledMap = new Map<string, ScheduledEntry[]>();
  for (const s of data?.scheduled ?? []) {
    const d = s.scheduled_for.slice(0, 10);
    if (!scheduledMap.has(d)) scheduledMap.set(d, []);
    scheduledMap.get(d)!.push(s);
  }

  const dayDataMap = new Map<string, CalendarDay>();
  data?.days.forEach((d) => dayDataMap.set(d.date, d));

  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const MONTH_LABELS = [
    '1월', '2월', '3월', '4월', '5월', '6월',
    '7월', '8월', '9월', '10월', '11월', '12월',
  ];

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else { setMonth((m) => m - 1); }
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else { setMonth((m) => m + 1); }
    setSelectedDay(null);
  };

  // 드래그 상태
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<CalendarItem | ScheduledEntry | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setDragActiveId(String(active.id));
    // Find the dragged item in data
    const allItems = [...(data?.days.flatMap((d) => d.items) ?? []), ...(data?.scheduled ?? [])];
    const found = allItems.find(
      (item) => `${item.source}-${item.id}` === active.id,
    );
    if (found) setActiveItem(found);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDragActiveId(null);
    setActiveItem(null);
    const { active, over } = event;
    if (!over || !over.id || over.id === active.id) return;

    // over.id is the target date string (YYYY-MM-DD)
    const targetDate = String(over.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return;

    const sourceId = String(active.id);
    const [source, id] = sourceId.split('-');
    if (!source || !id) return;

    setRescheduling(true);
    try {
      const res = await fetch('/api/content-calendar/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          source,
          scheduled_for: `${targetDate}T10:00:00Z`,
        }),
      });
      if (!res.ok) throw new Error('재예약 실패');
      await load();
    } catch (err) {
      console.error('Reschedule error:', err);
    } finally {
      setRescheduling(false);
    }
  };

  // 통계 계산
  const totalDraft = data?.days.reduce((a, d) => a + d.draft, 0) ?? 0;
  const totalConfirmed = data?.days.reduce((a, d) => a + d.confirmed, 0) ?? 0;
  const totalAffiliate = data?.days.reduce((a, d) => a + d.affiliate, 0) ?? 0;
  const totalScheduled = data?.scheduled.length ?? 0;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-admin-text">콘텐츠 캘린더</h1>
            <p className="text-sm text-admin-muted mt-1">
              통합 콘텐츠 발행 일정 · 드래그로 예약 변경
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* 플랫폼 필터 */}
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="text-xs border border-admin-border-mid rounded px-2 py-1.5 bg-white"
            >
              <option value="">모든 플랫폼</option>
              <option value="instagram">Instagram</option>
              <option value="threads">Threads</option>
              <option value="twitter">X/Twitter</option>
              <option value="blog_body">블로그</option>
              <option value="meta_ads">Meta Ads</option>
            </select>
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                플랫폼
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                어필리에이터
              </span>
            </div>
          </div>
        </div>

        <ContentSubNav />

        {/* 통계 요약 */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: '전체', value: data.totalCards, color: 'text-admin-text' },
              { label: '초안', value: totalDraft, color: 'text-gray-500' },
              { label: '확인됨', value: totalConfirmed, color: 'text-green-600' },
              { label: '어필리에이터', value: totalAffiliate, color: 'text-amber-600' },
              { label: '예약', value: totalScheduled, color: 'text-blue-600' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs px-4 py-3 text-center"
              >
                <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-[11px] text-admin-muted-2">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* 로딩 인디케이터 */}
        {rescheduling && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700 flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            예약 일정 변경 중...
          </div>
        )}

        {/* 캘린더 */}
        <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
          {/* 헤더 */}
          <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
            <button onClick={prevMonth} className="text-sm text-admin-muted hover:text-admin-text-2">
              ← {month === 1 ? `12월` : `${month - 1}월`}
            </button>
            <h2 className="font-semibold text-admin-text">
              {year}년 {MONTH_LABELS[month - 1]}
            </h2>
            <button onClick={nextMonth} className="text-sm text-admin-muted hover:text-admin-text-2">
              {month === 12 ? `1월` : `${month + 1}월`} →
            </button>
          </div>

          {loading ? (
            <div className="p-12 text-center text-sm text-admin-muted-2">로딩 중...</div>
          ) : (
            <>
              {/* 요일 헤더 */}
              <div className="grid grid-cols-7 border-b border-admin-border">
                {DAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className={`px-3 py-2 text-xs font-medium text-admin-muted text-center ${
                      label === '일' ? 'text-red-400' : label === '토' ? 'text-blue-400' : ''
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* 날짜 그리드 */}
              <div className="grid grid-cols-7">
                {/* 빈 칸 (첫 주) */}
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="min-h-[100px] bg-gray-50/50 border-b border-r border-admin-border p-1"
                  />
                ))}

                {/* 날짜 */}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayData = dayDataMap.get(dateStr);
                  const isToday = dateStr === today;
                  const isSelected = selectedDay === dateStr;
                  const dow = new Date(year, month - 1, day).getDay();
                  const scheduledForDay = scheduledMap.get(dateStr) ?? [];

                  return (
                    <DroppableCell
                      key={dateStr}
                      dateStr={dateStr}
                      day={day}
                      isToday={isToday}
                      isSelected={isSelected}
                      dow={dow}
                      onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                      scheduledItems={scheduledForDay}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 선택한 날짜의 상세 패널 */}
        {selectedDay && (
          <DayDetailPanel
            dateStr={selectedDay}
            dayData={dayDataMap.get(selectedDay) ?? null}
            scheduledItems={scheduledMap.get(selectedDay) ?? []}
            onRefresh={load}
          />
        )}

        {/* 성과 기반 추천 패널 */}
        <RecommendationsPanel
          show={showRecommendations}
          onToggle={() => setShowRecommendations(!showRecommendations)}
        />
      </div>

      {/* DragOverlay */}
      <DragOverlay>
        {dragActiveId && activeItem ? (
          <div className="opacity-80 shadow-lg rounded-lg px-3 py-2 bg-white border border-indigo-300 text-sm">
            {activeItem.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────────────────────────────
// Day Detail Panel
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 성과 기반 추천 패널
// ─────────────────────────────────────────────
function RecommendationsPanel({
  show,
  onToggle,
}: {
  show: boolean;
  onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    topTemplates: Array<{
      template: string;
      avgEngagementRate: number;
      avgPerformanceScore: number;
      cardCount: number;
    }>;
    topAngles: Array<{
      angle: string;
      avgEngagementRate: number;
      cardCount: number;
    }>;
    bestPostingHour: number | null;
    meta: { totalSnapshots: number; analyzedCards: number };
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content-calendar/recommendations?days=90');
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (show && !data && !loading) load();
  }, [show, data, loading, load]);

  const ANGLE_LABELS: Record<string, string> = {
    luxury: '럭셔리',
    value: '가성비',
    urgency: '긴급/마감',
    emotional: '감성',
    filial: '효도',
    activity: '액티비티',
    food: '미식',
  };

  const TEMPLATE_LABELS: Record<string, string> = {
    editorial: 'Editorial',
    cinematic: 'Cinematic',
    premium: 'Premium',
    bold: 'Bold',
  };

  return (
    <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-admin-bg transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <div className="text-left">
            <h3 className="font-semibold text-admin-text">성과 기반 콘텐츠 추천</h3>
            <p className="text-xs text-admin-muted">
              과거 {90}일간 engagement 데이터로 최적 템플릿/각도 추천
            </p>
          </div>
        </div>
        <span className={`transition-transform ${show ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {show && (
        <div className="px-6 pb-6 space-y-5 border-t border-admin-border pt-4">
          {loading ? (
            <div className="py-6 text-center text-sm text-admin-muted-2">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              성과 데이터 분석 중...
            </div>
          ) : !data ? (
            <div className="py-6 text-center text-sm text-admin-muted-2">
              데이터를 불러올 수 없습니다.
            </div>
          ) : (
            <>
              {/* 메타 정보 */}
              <div className="text-xs text-admin-muted-2">
                {data.meta.totalSnapshots}개 스냅샷 · {data.meta.analyzedCards}개 카드뉴스 분석
                {data.bestPostingHour != null && (
                  <span className="ml-3 font-medium text-blue-600">
                    최적 게시 시간: {data.bestPostingHour}:00
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 템플릿 추천 */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-admin-muted mb-2">
                    🎨 템플릿 성과 순위
                  </h4>
                  <div className="space-y-1.5">
                    {data.topTemplates.map((t, i) => (
                      <div
                        key={t.template}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                          i === 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold w-4 ${i === 0 ? 'text-emerald-700' : 'text-admin-muted'}`}>
                            {i + 1}
                          </span>
                          <span className={`text-sm font-medium ${i === 0 ? 'text-emerald-800' : 'text-admin-text'}`}>
                            {TEMPLATE_LABELS[t.template] ?? t.template}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-semibold text-emerald-600">
                            ⚡ {t.avgEngagementRate}%
                          </span>
                          <span className="text-admin-muted-2">
                            {t.cardCount}회
                          </span>
                        </div>
                      </div>
                    ))}
                    {data.topTemplates.length === 0 && (
                      <p className="text-xs text-admin-muted-2 py-2">데이터 부족</p>
                    )}
                  </div>
                </div>

                {/* Angle 추천 */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-admin-muted mb-2">
                    🎯 각도(Angle) 성과 순위
                  </h4>
                  <div className="space-y-1.5">
                    {data.topAngles.map((a, i) => (
                      <div
                        key={a.angle}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                          i === 0 ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold w-4 ${i === 0 ? 'text-blue-700' : 'text-admin-muted'}`}>
                            {i + 1}
                          </span>
                          <span className={`text-sm font-medium ${i === 0 ? 'text-blue-800' : 'text-admin-text'}`}>
                            {ANGLE_LABELS[a.angle] ?? a.angle}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="font-semibold text-blue-600">
                            ⚡ {a.avgEngagementRate}%
                          </span>
                          <span className="text-admin-muted-2">
                            {a.cardCount}회
                          </span>
                        </div>
                      </div>
                    ))}
                    {data.topAngles.length === 0 && (
                      <p className="text-xs text-admin-muted-2 py-2">데이터 부족</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DayDetailPanel({
  dateStr,
  dayData,
  scheduledItems,
  onRefresh,
}: {
  dateStr: string;
  dayData: CalendarDay | null;
  scheduledItems: ScheduledEntry[];
  onRefresh: () => void;
}) {
  const [editScheduledId, setEditScheduledId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editing, setEditing] = useState(false);

  const handleReschedule = async (entry: ScheduledEntry) => {
    if (!editTime) return;
    const [hours, minutes] = editTime.split(':');
    const newDate = new Date(dateStr + `T${hours}:${minutes}:00`);
    if (isNaN(newDate.getTime())) return;

    setEditing(true);
    try {
      const res = await fetch('/api/content-calendar/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entry.id,
          source: entry.source,
          platform: entry.platform,
          scheduled_for: newDate.toISOString(),
        }),
      });
      if (!res.ok) throw new Error('리스케줄 실패');
      setEditScheduledId(null);
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : '리스케줄 실패');
    } finally {
      setEditing(false);
    }
  };

  return (
    <div className="bg-admin-surface rounded-admin-md border border-admin-border-mid shadow-admin-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-admin-text-2">
            {new Date(dateStr).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </h2>
          {dayData && (
            <p className="text-xs text-admin-muted mt-0.5">
              총 {dayData.total}개 · 플랫폼 {dayData.platform}개 · 어필리에이터 {dayData.affiliate}개
              · 예약 {scheduledItems.length}건
            </p>
          )}
        </div>
        <span className="text-xs text-admin-muted-2">드래그하여 일정 변경</span>
      </div>

      {/* 예약된 발행 */}
      {scheduledItems.length > 0 && (
        <div className="px-6 py-3 border-b border-admin-border bg-blue-50/30">
          <p className="text-xs font-medium text-blue-700 mb-2">📅 예약된 발행 (드래그 가능)</p>
          <div className="space-y-2">
            {scheduledItems.map((s) => {
              const isEditing = editScheduledId === `${s.source}-${s.id}`;
              const scheduledTime = s.scheduled_for.slice(11, 16);
              const isPast = new Date(s.scheduled_for).getTime() < Date.now();
              const isPublished = s.status === 'published' || s.status === 'PUBLISHED';

              return (
                <div key={`${s.source}-${s.id}`} className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                        PLATFORM_COLORS[s.platform] ?? 'bg-gray-400'
                      }`}
                    />
                    <DraggableItem item={s} compact />
                  </div>

                  {!isPublished && (
                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            type="time"
                            value={editTime}
                            onChange={(e) => setEditTime(e.target.value)}
                            className="text-xs border border-admin-border-mid rounded px-1 py-0.5 w-20"
                          />
                          <button
                            onClick={() => handleReschedule(s)}
                            disabled={editing}
                            className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {editing ? '...' : '저장'}
                          </button>
                          <button
                            onClick={() => setEditScheduledId(null)}
                            className="text-xs text-admin-muted px-1 py-0.5"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={`text-[11px] ${isPast ? 'text-red-500' : 'text-admin-muted-2'}`}>
                            {scheduledTime}
                            {isPast && ' (지남)'}
                          </span>
                          <button
                            onClick={() => {
                              setEditScheduledId(`${s.source}-${s.id}`);
                              setEditTime(scheduledTime);
                            }}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 px-1"
                            title="시간 변경"
                          >
                            ✏️
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {isPublished && (
                    <span className="text-[11px] text-emerald-600 shrink-0">✓ 발행됨</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 당일 item 목록 */}
      {dayData && (
        <div className="divide-y divide-gray-100">
          {dayData.items.map((item) => {
            const isScheduled = !!item.scheduled_for;
            const isPublished = item.status === 'PUBLISHED' || item.status === 'LAUNCHED';

            return (
              <div key={`${item.source}-${item.id}`} className="px-6 py-3 flex items-center gap-3 hover:bg-admin-bg">
                <span className={`w-2 h-2 rounded-full shrink-0 ${item.type === 'affiliate' ? 'bg-amber-500' : 'bg-purple-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-admin-text truncate">{item.title}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {/* 플랫폼별 상태 뱃지 */}
                    {Object.entries(item.platform_statuses).map(([platform, status]) => {
                      if (!status) return null;
                      return (
                        <span
                          key={platform}
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                            status === 'published'
                              ? 'bg-emerald-50 text-emerald-700'
                              : status === 'queued' || status === 'scheduled'
                                ? 'bg-blue-50 text-blue-700'
                                : status === 'failed'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-gray-50 text-gray-600'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${PLATFORM_COLORS[platform] ?? 'bg-gray-400'}`} />
                          {PLATFORM_LABELS[platform] ?? platform}
                          {status === 'published' ? ' ✓' : status === 'queued' ? ' ⏳' : ''}
                        </span>
                      );
                    })}

                    {/* 상태 */}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${STATUS_PILLS[item.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[item.status] || item.status}
                    </span>

                    {item.branding_level === 'white_label' && (
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-violet-50 text-violet-700">
                        화이트라벨
                      </span>
                    )}
                  </div>
                </div>

                {/* 액션 */}
                <div className="flex gap-1 shrink-0">
                  {isScheduled && !isPublished && (
                    <button
                      onClick={() => {
                        setEditScheduledId(`${item.source}-${item.id}`);
                        setEditTime(item.scheduled_for?.slice(11, 16) ?? '10:00');
                      }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 px-1"
                    >
                      시간변경
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!dayData && scheduledItems.length === 0 && (
        <div className="px-6 py-8 text-center text-sm text-admin-muted-2">
          이 날짜에 예약된 콘텐츠가 없습니다.
        </div>
      )}
    </div>
  );
}
