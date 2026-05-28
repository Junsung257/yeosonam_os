'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ── 타입 ─────────────────────────────────────────────────────

interface MileageBalance {
  balance: number;
  grade: string;
  totalEarned: number;
  totalUsed: number;
  totalSpent: number;
}

interface CustomerBadge {
  id: string;
  badge_type: string;
  badge_label: string | null;
  badge_description: string | null;
  earned_at: string;
}

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastCheckin: string | null;
  todayChecked: boolean;
}

interface MileageTx {
  id: string;
  amount: number;
  type: 'EARNED' | 'USED' | 'EXPIRED' | 'CLAWBACK';
  memo: string | null;
  base_net_profit: number;
  mileage_rate: number;
  created_at: string;
  expires_at: string | null;
}

// ── 등급 설정 ─────────────────────────────────────────────────

const GRADE_META: Record<string, {
  label: string;
  earnRate: string;
  color: string;
  icon: string;
  minSpent: number;
  nextLabel?: string;
  nextMin?: number;
  condition?: string;
}> = {
  신규: {
    label: '신규', earnRate: '1%', color: 'from-green-500 to-green-400',
    icon: '🌱', minSpent: 0, nextLabel: '일반', nextMin: 500000,
    condition: '누적 결제 50만원 달성',
  },
  일반: {
    label: '일반', earnRate: '1%', color: 'from-gray-500 to-gray-400',
    icon: '🚀', minSpent: 500000, nextLabel: '우수', nextMin: 3_000_000,
    condition: '누적 결제 300만원 달성',
  },
  우수: {
    label: '우수', earnRate: '3%', color: 'from-blue-600 to-blue-400',
    icon: '🌟', minSpent: 3_000_000, nextLabel: 'VVIP', nextMin: 10_000_000,
    condition: '누적 결제 1,000만원 달성',
  },
  VVIP: {
    label: 'VVIP', earnRate: '5%', color: 'from-purple-600 to-indigo-500',
    icon: '💎', minSpent: 10_000_000,
  },
};

const TX_LABEL: Record<string, { label: string; color: string }> = {
  EARNED:   { label: '적립',  color: 'text-blue-600 bg-blue-50' },
  USED:     { label: '사용',  color: 'text-red-600 bg-red-50' },
  EXPIRED:  { label: '소멸',  color: 'text-gray-500 bg-gray-100' },
  CLAWBACK: { label: '회수',  color: 'text-orange-600 bg-orange-50' },
};

// 뱃지 아이콘/라벨
const BADGE_ICONS: Record<string, string> = {
  milestone_1m: '🥉', milestone_3m: '🥈', milestone_5m: '🥇',
  milestone_10m: '💎', milestone_30m: '👑',
  first_booking: '🎉', triple_booking: '🌟', ten_booking: '🏆',
  review_writer: '✍️', vvip_achieved: '💎', six_month_streak: '🔥',
  streak_7: '⭐', streak_30: '🔥', streak_100: '⚡',
  summer_champion: '🏖️', explorer: '🗺️', ambassador: '🤝',
};

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── 마일리지 페이지 ──────────────────────────────────────────

export default function MileagePage() {
  const router = useRouter();

  // ── 상태 ──────────────────────────────────────────────────
  const [balance, setBalance] = useState<MileageBalance | null>(null);
  const [history, setHistory] = useState<MileageTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [txFilter, setTxFilter] = useState<'ALL' | 'EARNED' | 'USED' | 'EXPIRED' | 'CLAWBACK'>('ALL');
  const pageRef = useRef(0);

  // ── 뱃지 / 출석 체크 상태 ────────────────────────────────
  const [badges, setBadges] = useState<CustomerBadge[]>([]);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [challenges, setChallenges] = useState<Record<string, unknown>[]>([]);

  // ── 데이터 로드 ──────────────────────────────────────────

  const loadBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/mileage/balance');
      if (res.ok) {
        const data = await res.json();
        setBalance(data);
      }
    } catch {
      // 오류 무시
    }
  }, []);

  const loadHistory = useCallback(async (reset = false) => {
    if (reset) {
      pageRef.current = 0;
      setHistory([]);
      setHasMore(true);
    }

    const params = new URLSearchParams({
      limit: '20',
      offset: String(pageRef.current * 20),
    });
    if (txFilter !== 'ALL') params.set('type', txFilter);

    try {
      const res = await fetch(`/api/customers/me/mileage-history?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(prev => reset ? data.transactions : [...prev, ...data.transactions]);
        setHasMore(data.hasMore ?? false);
        pageRef.current += 1;
      }
    } catch {
      // 오류 무시
    }
  }, [txFilter]);

  // 초기 로드
  useEffect(() => {
    Promise.all([
      loadBalance(),
      loadHistory(true),
      fetch('/api/customers/me/badges').then(r => r.ok && r.json()).then(d => d?.badges && setBadges(d.badges)).catch(() => {}),
      fetch('/api/gamification/checkin').then(r => r.ok && r.json()).then(d => d?.streak && setStreak(d.streak)).catch(() => {}),
      fetch('/api/gamification/challenges').then(r => r.ok && r.json()).then(d => d?.challenges && setChallenges(d.challenges)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [loadBalance, loadHistory]);

  // 필터 변경 시 리로드
  useEffect(() => {
    loadHistory(true);
  }, [txFilter, loadHistory]);

  // ── 무한 스크롤 ────────────────────────────────────────────

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    await loadHistory(false);
    setLoadingMore(false);
  }, [loadingMore, hasMore, loadHistory]);

  // ── 출석 체크 ──────────────────────────────────────────────

  const handleCheckin = useCallback(async () => {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      const res = await fetch('/api/gamification/checkin', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStreak(data.streak);
        if (!data.alreadyCheckedIn) {
          // 잔액 리로드
          loadBalance();
          if (data.newBadges.length > 0) {
            const bRes = await fetch('/api/customers/me/badges');
            if (bRes.ok) {
              const bData = await bRes.json();
              setBadges(bData.badges);
            }
          }
        }
      }
    } catch {
      // 오류 무시
    } finally {
      setCheckingIn(false);
    }
  }, [checkingIn, loadBalance]);

  // ── 등급 정보 ──────────────────────────────────────────────

  const gradeMeta = GRADE_META[balance?.grade ?? ''] ?? GRADE_META['신규'];
  const progress = gradeMeta.nextMin
    ? Math.min(100, Math.round(((balance?.totalSpent ?? 0) / gradeMeta.nextMin) * 100))
    : 100;

  // ── 렌더링 ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">마일리지 정보 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 p-1">←</button>
        <h1 className="font-bold text-gray-900">마일리지</h1>
        <div className="w-8" />
      </header>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-5 pb-24">

        {/* ── 등급 + 잔액 카드 ─────────────────────────────── */}
        <div className={`bg-gradient-to-br ${gradeMeta.color} rounded-2xl p-5 text-white shadow-lg`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs opacity-80 font-medium">보유 마일리지</p>
              <p className="text-3xl font-extrabold mt-0.5">₩{fmt(balance?.balance ?? 0)}</p>
            </div>
            <span className="text-4xl">{gradeMeta.icon}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="bg-white/20 backdrop-blur text-xs font-bold px-3 py-1 rounded-full">
              {gradeMeta.label} 회원
            </span>
            <span className="text-xs opacity-80">적립률 {gradeMeta.earnRate}</span>
          </div>
        </div>

        {/* ── 요약 통계 ─────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '총 적립', value: `+₩${fmt(balance?.totalEarned ?? 0)}`, color: 'text-blue-600' },
            { label: '총 사용', value: `-₩${fmt(balance?.totalUsed ?? 0)}`, color: 'text-red-500' },
            { label: '누적 결제', value: `₩${fmt(balance?.totalSpent ?? 0)}`, color: 'text-gray-700' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-xl p-4 text-center border border-gray-100 shadow-sm">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`font-bold text-sm ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── 등급 진행바 ───────────────────────────────────── */}
        {gradeMeta.nextMin && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-800">
                다음 등급: {gradeMeta.nextLabel}
              </p>
              <span className="text-xs font-medium text-brand">{progress}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className="bg-gradient-to-r from-brand to-blue-400 rounded-full h-2.5 transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{gradeMeta.condition}</p>
            <p className="text-xs text-gray-400 mt-1">
              현재까지 ₩{fmt(balance?.totalSpent ?? 0)} 결제
            </p>
          </div>
        )}

        {/* ── 등급별 혜택 안내 ─────────────────────────────── */}
        <details className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <summary className="px-4 py-3 font-semibold text-sm text-gray-800 cursor-pointer hover:bg-gray-50">
            등급별 혜택 안내
          </summary>
          <div className="px-4 pb-4 space-y-2">
            {[
              { grade: 'VVIP', earnRate: '5%', desc: '최고 등급 · 모든 상품 5% 적립 · 우선 예약' },
              { grade: '우수', earnRate: '3%', desc: '누적 300만원 이상 · 3% 적립' },
              { grade: '일반', earnRate: '1%', desc: '누적 50만원 이상 · 1% 적립' },
              { grade: '신규', earnRate: '1%', desc: '첫 방문 · 1% 적립 · 웰컴 혜택' },
            ].map((item) => (
              <div key={item.grade} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <span className="font-semibold text-gray-700">{item.grade}</span>
                  <span className="text-gray-400 ml-2">{item.desc}</span>
                </div>
                <span className="font-bold text-brand">{item.earnRate}</span>
              </div>
            ))}
          </div>
        </details>

        {/* ── 출석 체크 ─────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm text-gray-800">출석 체크</p>
            {streak && (
              <span className="text-xs font-medium text-amber-600">
                🔥 {streak.currentStreak}일 연속
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            매일 출석하고 마일리지를 받으세요! 7일·30일·100일 연속 시 보너스 지급
          </p>
          <button
            onClick={handleCheckin}
            disabled={checkingIn || (streak?.todayChecked ?? false)}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition ${
              streak?.todayChecked
                ? 'bg-gray-100 text-gray-400 cursor-default'
                : 'bg-gradient-to-r from-amber-400 to-orange-400 text-white hover:from-amber-500 hover:to-orange-500 shadow-sm'
            }`}
          >
            {checkingIn ? '처리 중...'
              : streak?.todayChecked ? '✅ 오늘 출석 완료'
              : '☀️ 오늘 출석하기 (+10P)'}
          </button>
          {streak && (
            <p className="text-[10px] text-gray-400 mt-2 text-center">
              최장 연속: {streak.longestStreak}일
            </p>
          )}
        </div>

        {/* ── 내 뱃지 ────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm text-gray-800">내 뱃지</p>
            <span className="text-[10px] text-gray-400">{badges.length}개</span>
          </div>
          {badges.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              아직 획득한 뱃지가 없습니다<br />
              예약하고 출석 체크하며 뱃지를 모아보세요!
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {badges.slice(0, 8).map(b => (
                <div key={b.id} className="flex flex-col items-center gap-1">
                  <span className="text-2xl">{BADGE_ICONS[b.badge_type] ?? '🏅'}</span>
                  <span className="text-[9px] text-gray-500 text-center leading-tight line-clamp-2">
                    {b.badge_label ?? b.badge_type}
                  </span>
                </div>
              ))}
              {badges.length > 8 && (
                <div className="flex flex-col items-center justify-center text-xs text-gray-400">
                  +{badges.length - 8}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 진행 중인 챌린지 ──────────────────────────────── */}
        {challenges.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="font-semibold text-sm text-gray-800 mb-3">진행 중인 챌린지</p>
            <div className="space-y-3">
              {challenges.map((ch: Record<string, unknown>) => {
                const participant = ch.participant as Record<string, unknown> | null;
                const progress = (participant?.progress as number) ?? 0;
                const conditionVal = (ch.condition_value as number) ?? 1;
                const completed = (participant?.completed as boolean) ?? false;
                const pct = Math.min(100, Math.round((progress / conditionVal) * 100));
                return (
                  <div key={ch.id as string} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium text-gray-800">{ch.title as string}</p>
                        <span className="text-[10px] font-bold text-brand">{ch.reward_mileage as number}P</span>
                      </div>
                      <p className="text-[10px] text-gray-500 mb-1.5">{ch.description as string}</p>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-gradient-to-r from-green-400 to-emerald-500 rounded-full h-1.5 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-gray-400 mt-0.5">
                        {progress}/{conditionVal} {completed ? '· ✅ 완료' : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 사용 방법 안내 ───────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <p className="font-semibold text-sm text-gray-800 mb-2">마일리지 사용 방법</p>
          <ul className="text-xs text-gray-600 space-y-1.5">
            <li>• 결제 시 최대 30%까지 마일리지 사용 가능</li>
            <li>• 마일리지 사용해도 원가는 변하지 않습니다</li>
            <li>• 적립일로부터 2년 동안 사용하지 않으면 자동 소멸됩니다</li>
            <li>• 결제 취소 시 적립된 마일리지는 자동 회수됩니다</li>
          </ul>
          <Link
            href="/packages"
            className="mt-3 inline-flex items-center gap-1 bg-brand text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-blue-700 transition"
          >
            여행 상품 둘러보기 →
          </Link>
        </div>

        {/* ── 거래 내역 ─────────────────────────────────────── */}
        <div>
          <h2 className="font-bold text-gray-900 mb-3 text-sm">거래 내역</h2>

          {/* 필터 탭 */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
            {([
              { key: 'ALL', label: '전체' },
              { key: 'EARNED', label: '적립' },
              { key: 'USED', label: '사용' },
              { key: 'CLAWBACK', label: '소멸/회수' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setTxFilter(tab.key)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                  txFilter === tab.key
                    ? 'bg-white shadow-sm text-brand font-semibold'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 거래 목록 */}
          {history.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm">거래 내역이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((tx) => {
                const txInfo = TX_LABEL[tx.type] ?? { label: tx.type, color: 'text-gray-500 bg-gray-100' };
                return (
                  <div
                    key={tx.id}
                    className="bg-white rounded-xl px-4 py-3 border border-gray-100 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${txInfo.color}`}>
                          {txInfo.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(tx.created_at).toLocaleDateString('ko-KR')}
                        </span>
                      </div>
                      <span className={`font-bold text-sm ${
                        tx.amount > 0 ? 'text-blue-600' : 'text-red-500'
                      }`}>
                        {tx.amount > 0 ? '+' : ''}₩{fmt(tx.amount)}
                      </span>
                    </div>
                    {tx.memo && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">{tx.memo}</p>
                    )}
                    {tx.expires_at && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        소멸 예정일: {new Date(tx.expires_at).toLocaleDateString('ko-KR')}
                      </p>
                    )}
                  </div>
                );
              })}

              {/* 더보기 */}
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full py-3 text-sm text-brand font-medium hover:bg-blue-50 rounded-xl transition disabled:opacity-50"
                >
                  {loadingMore ? '불러오는 중...' : '더 보기'}
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
