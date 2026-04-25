'use client';

/**
 * 어드민 글로벌 ⌘K 명령 팔레트.
 *
 * 기능:
 *   - 정적 명령 (네비게이션 46개 + 액션) fuzzy 검색 + frecency 랭킹
 *   - 동적 검색 (예약/고객/상품) — 250ms debounce, 결과 통합
 *   - 키보드 네비 (↑↓, Enter, ESC)
 *   - frecency 자동 학습 (선택 시 timestamp 기록)
 *
 * Linear / Superhuman 표준 패턴.
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, CornerDownLeft } from 'lucide-react';
import type { AdminCommand } from '@/lib/admin-commands/registry';
import { fuzzyScore, maxFuzzyScore } from '@/lib/admin-commands/fuzzy-score';
import { recordUse, getFrecencyScore } from '@/lib/admin-commands/frecency';
import { searchAll, type DynamicResult } from '@/lib/admin-commands/search-providers';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** 정적 명령 카탈로그 (네비 + 액션) */
  staticCommands: AdminCommand[];
  /** 액션 명령 실행 핸들러 (kind='action') */
  onRunAction?: (cmd: AdminCommand) => void;
}

interface ScoredCommand {
  cmd: AdminCommand;
  score: number;
}

interface ScoredDynamic {
  result: DynamicResult;
  score: number;
}

const DEBOUNCE_MS = 220;
const STATIC_LIMIT = 12;
const DYNAMIC_LIMIT = 9;

export function CommandPalette({
  open,
  onClose,
  staticCommands,
  onRunAction,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const [dynamic, setDynamic] = useState<DynamicResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // open 시 input focus + state 리셋
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusIdx(0);
      setDynamic([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // 동적 검색 debounce
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setDynamic([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchAll(q);
      setDynamic(results);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // 정적 명령 점수 매기기
  const scoredStatic: ScoredCommand[] = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // 쿼리 비었을 때: frecency 상위 + 알파벳 순
      return staticCommands
        .map((cmd) => ({
          cmd,
          score: getFrecencyScore(cmd.id) + 0.001 * (1 / (cmd.label.length || 1)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, STATIC_LIMIT);
    }
    return staticCommands
      .map((cmd) => {
        const matchScore = maxFuzzyScore(q, [
          cmd.label,
          cmd.group,
          ...(cmd.keywords ?? []),
        ]);
        if (matchScore === 0) return null;
        // frecency 보너스: 최대 +0.3 정도까지
        const frec = Math.min(0.3, getFrecencyScore(cmd.id) * 0.05);
        return { cmd, score: matchScore + frec };
      })
      .filter((x): x is ScoredCommand => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, STATIC_LIMIT);
  }, [query, staticCommands]);

  // 동적 검색 점수 매기기
  const scoredDynamic: ScoredDynamic[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return dynamic
      .map((r) => ({
        result: r,
        score: maxFuzzyScore(q, [r.label, r.hint ?? '']),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, DYNAMIC_LIMIT);
  }, [query, dynamic]);

  const flatItems = useMemo(
    () => [
      ...scoredStatic.map((s) => ({ kind: 'static' as const, ...s })),
      ...scoredDynamic.map((s) => ({ kind: 'dynamic' as const, ...s })),
    ],
    [scoredStatic, scoredDynamic],
  );

  // focusIdx clamp
  useEffect(() => {
    if (focusIdx >= flatItems.length) setFocusIdx(0);
  }, [flatItems.length, focusIdx]);

  const runItem = useCallback(
    (item: (typeof flatItems)[number]) => {
      if (item.kind === 'static') {
        recordUse(item.cmd.id);
        if (item.cmd.kind === 'navigate' && item.cmd.href) {
          router.push(item.cmd.href);
        } else if (item.cmd.kind === 'action' && onRunAction) {
          onRunAction(item.cmd);
        }
      } else {
        recordUse(item.result.id);
        router.push(item.result.href);
      }
      onClose();
    },
    [router, onRunAction, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, Math.max(0, flatItems.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[focusIdx];
        if (item) runItem(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [flatItems, focusIdx, runItem, onClose],
  );

  if (!open) return null;

  // 그룹별 묶기 — 첫 등장 인덱스로 헤더 노출
  const groupedNodes: ReactNode[] = [];
  let lastGroup = '';
  let runningIdx = 0;

  scoredStatic.forEach((s) => {
    const group = s.cmd.group;
    if (group !== lastGroup) {
      groupedNodes.push(
        <div
          key={`gh-${group}-${runningIdx}`}
          className="px-3 pt-2.5 pb-1 text-admin-xs font-semibold uppercase tracking-wider text-admin-textSubtle"
        >
          {group}
        </div>,
      );
      lastGroup = group;
    }
    const idx = runningIdx;
    const focused = idx === focusIdx;
    const Icon = s.cmd.icon;
    groupedNodes.push(
      <button
        key={s.cmd.id}
        onMouseEnter={() => setFocusIdx(idx)}
        onClick={() => runItem({ kind: 'static', cmd: s.cmd, score: s.score })}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-admin-sm transition-colors ${
          focused ? 'bg-blue-50 text-admin-text' : 'text-admin-text hover:bg-slate-50'
        }`}
      >
        {Icon && <Icon size={15} className="text-admin-textMuted shrink-0" strokeWidth={2} />}
        <span className="flex-1 truncate">{s.cmd.label}</span>
        {s.cmd.hint && (
          <span className="text-admin-xs text-admin-textSubtle">{s.cmd.hint}</span>
        )}
        {s.cmd.shortcut && (
          <kbd className="text-admin-xs bg-slate-100 text-admin-textMuted px-1.5 py-0.5 rounded font-mono border border-slate-200">
            {s.cmd.shortcut}
          </kbd>
        )}
        {focused && <CornerDownLeft size={12} className="text-admin-textSubtle" />}
      </button>,
    );
    runningIdx++;
  });

  // 동적 결과 렌더
  if (scoredDynamic.length > 0) {
    let lastDynGroup = '';
    scoredDynamic.forEach((s) => {
      if (s.result.group !== lastDynGroup) {
        groupedNodes.push(
          <div
            key={`dgh-${s.result.group}-${runningIdx}`}
            className="px-3 pt-2.5 pb-1 text-admin-xs font-semibold uppercase tracking-wider text-admin-textSubtle border-t border-admin-border mt-1"
          >
            {s.result.group} 검색
          </div>,
        );
        lastDynGroup = s.result.group;
      }
      const idx = runningIdx;
      const focused = idx === focusIdx;
      const Icon = s.result.icon;
      groupedNodes.push(
        <button
          key={s.result.id}
          onMouseEnter={() => setFocusIdx(idx)}
          onClick={() => runItem({ kind: 'dynamic', result: s.result, score: s.score })}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-admin-sm transition-colors ${
            focused ? 'bg-blue-50 text-admin-text' : 'text-admin-text hover:bg-slate-50'
          }`}
        >
          <Icon size={15} className="text-admin-textMuted shrink-0" strokeWidth={2} />
          <span className="flex-1 truncate">{s.result.label}</span>
          {s.result.hint && (
            <span className="text-admin-xs text-admin-textSubtle truncate max-w-[200px]">
              {s.result.hint}
            </span>
          )}
          <ArrowRight size={12} className={focused ? 'text-blue-500' : 'text-admin-textSubtle'} />
        </button>,
      );
      runningIdx++;
    });
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[14vh] bg-black/35 backdrop-blur-sm admin-scope"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-admin-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 입력창 */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-admin-border">
          <Search size={16} className="text-admin-textSubtle shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocusIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="페이지·예약·고객·상품 검색..."
            className="flex-1 text-admin-base text-admin-text placeholder:text-admin-textSubtle bg-transparent border-none outline-none focus:ring-0"
          />
          {searching && (
            <span className="text-admin-xs text-admin-textSubtle">검색중...</span>
          )}
          <kbd className="text-admin-xs bg-slate-100 text-admin-textMuted px-1.5 py-0.5 rounded font-mono border border-slate-200">
            ESC
          </kbd>
        </div>

        {/* 결과 */}
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {flatItems.length === 0 ? (
            <p className="text-admin-sm text-admin-textSubtle text-center py-12">
              {query.trim().length < 2
                ? '검색어를 입력하거나 명령을 선택하세요'
                : searching
                  ? '검색 중...'
                  : '결과 없음'}
            </p>
          ) : (
            groupedNodes
          )}
        </div>

        {/* 푸터 */}
        <div className="px-3 py-2 border-t border-admin-border flex items-center gap-3 text-admin-xs text-admin-textSubtle">
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200">↑↓</kbd>
            이동
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200">↵</kbd>
            실행
          </span>
          <span className="ml-auto text-admin-textSubtle">
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200">?</kbd>
            로 단축키 도움말
          </span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
