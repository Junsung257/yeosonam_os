'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bot, X, Sparkles, SendHorizontal, ExternalLink,
  Zap, TrendingUp, BarChart3, BadgeDollarSign, Users, Package,
  Megaphone, Star, Wallet, FileText, Activity, Settings,
  Search, Link2, Send, MessageCircle, MapPinned, Building2,
} from 'lucide-react';
import { usePinnedItems, type PinnedItem } from '@/hooks/usePinnedItems';

/** 아이콘 이름 문자열 → Lucide React 컴포넌트 */
import type { LucideIcon } from 'lucide-react';
const ICON_MAP: Record<string, LucideIcon> = {
  'zap': Zap,
  'trending-up': TrendingUp,
  'bar-chart-3': BarChart3,
  'dollar-sign': BadgeDollarSign,
  'badge-dollar-sign': BadgeDollarSign,
  'users': Users,
  'package': Package,
  'megaphone': Megaphone,
  'bot': Bot,
  'star': Star,
  'wallet': Wallet,
  'file-text': FileText,
  'activity': Activity,
  'settings': Settings,
  'search': Search,
  'link': Link2,
  'send': Send,
  'message-circle': MessageCircle,
  'map-pinned': MapPinned,
  'building-2': Building2,
};

function iconNameToComponent(name: string) {
  return ICON_MAP[name] ?? Zap;
}

/**
 * 사이드바 하단에 표시되는 AI 명령 입력 위젯.
 * 자연어로 "매출 페이지 바로가기 추가" 같은 명령을 받아 pinned-items에 저장.
 */
export default function SidebarAIWidget() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'idle' | 'processing' | 'result' | 'error'>('idle');
  const [resultMsg, setResultMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { pinned, add, remove } = usePinnedItems();

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  const handleSubmit = useCallback(() => {
    const text = inputRef.current?.value.trim();
    if (!text) return;

    setMode('processing');
    setResultMsg('');

    const addMatch = text.match(/(.+?)(?: 페이지| 화면| 메뉴)?\s*(?:바로가기\s*)?추가/);
    const goMatch = text.match(/(.+?)(?: 페이지| 화면| 메뉴)로?\s*(?:가자|이동|열어줘|보여줘|열기)/);
    const delMatch = text.match(/(.+?)\s*(?:바로가기|핀)\s*(?:삭제|제거|지워줘)/);

    let matched = false;

    if (delMatch) {
      const target = delMatch[1].trim();
      const found = pinned.find(
        (p) => p.label.includes(target) || target.includes(p.label),
      );
      if (found) {
        remove(found.href);
        setResultMsg(`'${found.label}' 바로가기를 삭제했어요`);
        matched = true;
      }
    } else if (addMatch || goMatch) {
      const phrase = (addMatch?.[1] ?? goMatch?.[1] ?? text).trim();

      const pageMap: Record<string, { label: string; href: string; iconName: string }> = {
        '매출': { label: '매출 대시보드', href: '/admin', iconName: 'bar-chart-3' },
        '대시보드': { label: '대시보드', href: '/admin', iconName: 'activity' },
        '상품': { label: '상품 관리', href: '/admin/packages', iconName: 'package' },
        '예약': { label: '예약 현황', href: '/admin/bookings', iconName: 'file-text' },
        '제휴': { label: '제휴 관리', href: '/admin/affiliates', iconName: 'users' },
        '정산': { label: '정산 관리', href: '/admin/settlements', iconName: 'wallet' },
        '마케팅': { label: '마케팅 성과', href: '/admin/marketing', iconName: 'megaphone' },
        '자비스': { label: '자비스 AI', href: '/admin/jarvis', iconName: 'bot' },
        '운영': { label: 'OS 관제탑', href: '/admin/control-tower', iconName: 'activity' },
        '리뷰': { label: '리뷰 분석', href: '/admin/reviews', iconName: 'star' },
        '업로드': { label: '업로드', href: '/admin/upload', iconName: 'send' },
        '게시글': { label: '게시글 관리', href: '/admin/blog', iconName: 'file-text' },
        '콘텐츠': { label: '콘텐츠 허브', href: '/admin/content-hub', iconName: 'megaphone' },
        '여행지': { label: '여행지 관리', href: '/admin/attractions', iconName: 'map-pinned' },
        '랜드사': { label: '랜드사 관리', href: '/admin/land-operators', iconName: 'building-2' },
        '광고': { label: '검색광고', href: '/admin/search-ads', iconName: 'megaphone' },
        '결제': { label: '입금/정산', href: '/admin/payments', iconName: 'wallet' },
        'FAQ': { label: 'FAQ 봇', href: '/admin/faq', iconName: 'message-circle' },
        '약관': { label: '약관 템플릿', href: '/admin/terms-templates', iconName: 'file-text' },
      };

      let bestMatch: typeof pageMap[string] | null = null;
      let bestScore = 0;
      for (const [key, val] of Object.entries(pageMap)) {
        const score = phrase.includes(key) || key.includes(phrase) ? key.length : 0;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = val;
        }
      }

      if (bestMatch) {
        const newItem: Omit<PinnedItem, 'id' | 'createdAt'> = {
          label: bestMatch.label,
          href: bestMatch.href,
          iconName: bestMatch.iconName,
        };
        add(newItem);
        setResultMsg(`'${bestMatch.label}'를(을) 바로가기에 추가했어요`);
        matched = true;
      }
    }

    if (!matched) {
      setResultMsg('죄송해요, 이해하지 못했어요. 자비스 AI에게 물어보세요');
      setMode('error');
      setTimeout(() => setMode('idle'), 3000);
      setInput('');
      return;
    }

    setMode('result');
    setInput('');
    setTimeout(() => {
      setMode('idle');
      setExpanded(false);
    }, 2500);
  }, [pinned, add, remove]); // input 대신 inputRef 사용으로 deps 최소화

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') {
      setExpanded(false);
      setMode('idle');
    }
  };

  if (!expanded) {
    return (
      <div className="px-2 pb-2">
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-admin-sm text-admin-xs text-admin-muted-2 hover:text-admin-text hover:bg-admin-surface-2 transition-colors"
          title="AI 명령 입력"
        >
          <Sparkles size={12} className="text-brand" />
          <span>AI 명령...</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 pb-2">
      <div className="bg-admin-surface-2 rounded-admin-md border border-admin-border p-2 space-y-2">
        <div className="flex items-center gap-1.5 text-admin-2xs font-semibold text-brand uppercase tracking-[0.06em]">
          <Bot size={10} />
          AI 명령
          <button
            onClick={() => { setExpanded(false); setMode('idle'); }}
            className="ml-auto p-0.5 rounded hover:bg-admin-surface text-admin-muted hover:text-admin-text"
          >
            <X size={10} />
          </button>
        </div>

        {mode === 'result' || mode === 'error' ? (
          <div className={`text-admin-xs ${mode === 'error' ? 'text-danger' : 'text-admin-text'} flex items-center gap-1.5`}>
            <Sparkles size={11} className={mode === 'error' ? 'text-danger' : 'text-warning'} />
            {resultMsg}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="'매출 바로가기 추가'..."
              disabled={mode === 'processing'}
              className="flex-1 bg-transparent border-0 outline-none text-admin-xs text-admin-text placeholder:text-admin-muted-2 py-0.5"
            />
            <button
              onClick={handleSubmit}
              disabled={mode === 'processing' || !input.trim()}
              className="p-0.5 rounded text-brand hover:text-brand-light disabled:text-admin-muted-2 transition-colors"
            >
              <SendHorizontal size={12} />
            </button>
          </div>
        )}

        {pinned.length > 0 && (
          <div className="space-y-0.5 pt-1 border-t border-admin-border">
            {pinned.map((item) => {
              const IconComponent = iconNameToComponent(item.iconName);
              return (
                <div key={item.id} className="group flex items-center gap-1">
                  <Link
                    href={item.href}
                    className="flex-1 flex items-center gap-1.5 px-1.5 py-0.5 rounded-admin-sm text-admin-2xs text-admin-text-2 hover:text-admin-text hover:bg-admin-surface transition-colors truncate"
                  >
                    <IconComponent size={10} strokeWidth={2} className="shrink-0 text-brand" />
                    <span className="truncate">{item.label}</span>
                    <ExternalLink size={8} className="ml-auto shrink-0 text-admin-muted-2 opacity-0 group-hover:opacity-100" />
                  </Link>
                  <button
                    onClick={() => remove(item.href)}
                    className="p-0.5 rounded text-admin-muted-2 opacity-0 group-hover:opacity-100 hover:text-danger transition-all"
                    title="삭제"
                  >
                    <X size={8} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
