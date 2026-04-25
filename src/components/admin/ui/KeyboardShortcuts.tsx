'use client';

/**
 * 어드민 글로벌 키보드 단축키 시스템.
 *
 * 패턴 (Linear / Superhuman):
 *   - 단일 키:   '/' (검색 포커스), '?' (도움말 토글), 'n' (새 항목), 'e' (편집)
 *   - 시퀀스:    g + b (예약), g + c (고객), g + l (장부), g + p (상품), g + s (정산)
 *   - 모달:      ESC (닫기) — 각 모달이 자체 처리
 *
 * 입력 필드(input/textarea/contenteditable) 안에서는 시퀀스/단일키 무시 (ESC 만 통과).
 *
 * 사용:
 *   const { shortcuts } = useShortcutRegistry();
 *   <KeyboardShortcutsHelp open={...} onClose={...} />
 *
 * useGlobalShortcuts(handlers) 가 ⌘K, ?, /, g+x 시퀀스를 잡음.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { Keyboard } from 'lucide-react';

export interface ShortcutDef {
  keys: string;        // 표시용 (예: 'G B', '?', '⌘K')
  label: string;
  group: '네비게이션' | '검색·도움' | '작업' | '뷰';
}

export const SHORTCUT_REGISTRY: ShortcutDef[] = [
  { keys: '⌘K',  label: '명령 팔레트 (페이지·예약·고객·상품 검색)', group: '검색·도움' },
  { keys: '/',   label: '현재 페이지의 검색창에 포커스',             group: '검색·도움' },
  { keys: '?',   label: '단축키 도움말 토글',                        group: '검색·도움' },
  { keys: 'ESC', label: '모달·드로어 닫기',                          group: '검색·도움' },

  { keys: 'G B', label: '예약 관리로 이동',     group: '네비게이션' },
  { keys: 'G C', label: '고객 관리로 이동',     group: '네비게이션' },
  { keys: 'G P', label: '상품 관리로 이동',     group: '네비게이션' },
  { keys: 'G L', label: '통합 장부로 이동',     group: '네비게이션' },
  { keys: 'G S', label: '정산 관리로 이동',     group: '네비게이션' },
  { keys: 'G I', label: 'Inbox 액션 큐로 이동', group: '네비게이션' },
  { keys: 'G D', label: '대시보드로 이동',      group: '네비게이션' },
  { keys: 'G J', label: '자비스 AI로 이동',     group: '네비게이션' },

  { keys: 'N',   label: '새 항목 추가 (페이지에 따라 새 예약/고객/상품)', group: '작업' },
  { keys: 'E',   label: '선택된 행 편집 모드',   group: '작업' },

  { keys: 'D',   label: '행 밀도 토글 (편안함/컴팩트)', group: '뷰' },
];

const SEQUENCE_TIMEOUT_MS = 800;

interface ShortcutsCtx {
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
}

const Ctx = createContext<ShortcutsCtx>({
  helpOpen: false,
  setHelpOpen: () => {},
});

export function useShortcuts() {
  return useContext(Ctx);
}

interface ShortcutsProviderProps {
  children: ReactNode;
  onOpenCommandPalette: () => void;
  onToggleDensity: () => void;
}

function isInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function focusPageSearch(): boolean {
  const el =
    (document.querySelector(
      'input[type="search"], input[placeholder*="검색" i]',
    ) as HTMLInputElement | null) ?? null;
  if (el) {
    el.focus();
    el.select?.();
    return true;
  }
  return false;
}

export function ShortcutsProvider({
  children,
  onOpenCommandPalette,
  onToggleDensity,
}: ShortcutsProviderProps) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const sequenceRef = useRef<{ key: string; ts: number } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput = isInputTarget(e.target);

      // ⌘K / Ctrl+K (입력 중에도 작동)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenCommandPalette();
        return;
      }

      // ESC: 도움말 닫기 (모달은 자체 처리)
      if (e.key === 'Escape') {
        if (helpOpen) {
          e.preventDefault();
          setHelpOpen(false);
        }
        return;
      }

      // 입력 중엔 단일 키 / 시퀀스 무시
      if (isInput) return;

      // ? 도움말 토글
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      // / 페이지 검색 포커스
      if (e.key === '/') {
        if (focusPageSearch()) {
          e.preventDefault();
        }
        return;
      }

      // 시퀀스 처리: g 누른 후 일정 시간 내에 다음 키
      const now = Date.now();
      const key = e.key.toLowerCase();

      if (sequenceRef.current && now - sequenceRef.current.ts < SEQUENCE_TIMEOUT_MS) {
        // g+? 처리
        if (sequenceRef.current.key === 'g') {
          const map: Record<string, string> = {
            b: '/admin/bookings',
            c: '/admin/customers',
            p: '/admin/packages',
            l: '/admin/ledger',
            s: '/admin/settlements',
            i: '/admin/inbox',
            d: '/admin',
            j: '/admin/jarvis',
          };
          const target = map[key];
          if (target) {
            e.preventDefault();
            router.push(target);
          }
          sequenceRef.current = null;
          return;
        }
      }

      // 시퀀스 시작: g
      if (key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        sequenceRef.current = { key: 'g', ts: now };
        return;
      }

      // 단일 키 액션
      if (key === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onToggleDensity();
        return;
      }

      // 시퀀스 만료
      if (sequenceRef.current && now - sequenceRef.current.ts >= SEQUENCE_TIMEOUT_MS) {
        sequenceRef.current = null;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [helpOpen, onOpenCommandPalette, onToggleDensity, router]);

  return <Ctx.Provider value={{ helpOpen, setHelpOpen }}>{children}</Ctx.Provider>;
}

/**
 * 단축키 도움말 모달
 */
export function KeyboardShortcutsHelp() {
  const { helpOpen, setHelpOpen } = useShortcuts();

  if (!helpOpen) return null;

  const groups: Record<string, ShortcutDef[]> = {};
  for (const s of SHORTCUT_REGISTRY) {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  }

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 backdrop-blur-sm admin-scope p-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-admin-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-admin-border flex items-center gap-2">
          <Keyboard size={16} className="text-admin-textMuted" />
          <h2 className="text-admin-md font-bold text-admin-text">키보드 단축키</h2>
          <span className="ml-auto text-admin-xs text-admin-textSubtle">
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200">
              ?
            </kbd>{' '}
            또는{' '}
            <kbd className="bg-slate-100 px-1.5 py-0.5 rounded font-mono border border-slate-200">
              ESC
            </kbd>{' '}
            로 닫기
          </span>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 max-h-[70vh] overflow-y-auto">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <h3 className="text-admin-xs font-semibold uppercase tracking-wider text-admin-textSubtle mb-2">
                {group}
              </h3>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li
                    key={s.keys + s.label}
                    className="flex items-center gap-3 text-admin-sm"
                  >
                    <span className="flex gap-1 shrink-0 min-w-[60px]">
                      {s.keys.split(' ').map((k, i) => (
                        <kbd
                          key={i}
                          className="bg-slate-100 text-admin-text px-1.5 py-0.5 rounded font-mono border border-slate-200 text-admin-xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-admin-textMuted">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="px-5 py-2.5 border-t border-admin-border text-admin-xs text-admin-textSubtle bg-slate-50">
          💡 단축키는 입력창에 포커스가 없을 때만 작동합니다. 시퀀스 단축키(예: G B)는 G를 누른 뒤 0.8초 안에 다음 키를 눌러야 합니다.
        </div>
      </div>
    </div>
  );
}

export default ShortcutsProvider;
