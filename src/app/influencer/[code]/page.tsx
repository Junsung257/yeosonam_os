'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useInfluencerAuth } from './auth-context';
import { Leaderboard } from '@/components/affiliate/Leaderboard';

// ── 타입 ──
interface Settlement {
  id: string;
  period: string;
  gross_amount: number;
  tax_amount: number;
  net_payout: number;
  status: string;
  settled_at?: string;
}

interface Booking {
  id: string;
  product_name?: string;
  booking_date?: string;
  status?: string;
  influencer_commission?: number;
  created_at: string;
}

interface ContentItem {
  id: string;
  product_id: string;
  platform: string;
  status: string;
  generation_agent?: string;
  created_at: string;
  published_at?: string | null;
}

interface ContentRevenue {
  content_id: string;
  bookings: number;
  revenue: number;
  commission: number;
}

interface DashboardData {
  affiliate: {
    id: string; name: string; referral_code: string;
    grade: number; grade_label: string; grade_rate: string; next_grade: string;
    bonus_rate: number; booking_count: number; total_commission: number;
    payout_type: string; logo_url?: string; created_at: string;
  };
  stats: {
    total_links: number; total_clicks: number;
    total_conversions: number; conversion_rate: string;
  };
  settlements: Settlement[];
  recent_bookings: Booking[];
  contents?: ContentItem[];
  content_revenue?: ContentRevenue[];
  co_brand?: { path: string; full_url: string; landing_views_30d: number };
  attribution_notice?: string;
}

// ── 등급 진행률 계산 ──
const GRADE_THRESHOLDS = [0, 10, 30, 50, 100];
function getGradeProgress(grade: number, bookingCount: number) {
  if (grade >= 5) return 100;
  const current = GRADE_THRESHOLDS[grade - 1] || 0;
  const next = GRADE_THRESHOLDS[grade] || 100;
  return Math.min(100, Math.round(((bookingCount - current) / (next - current)) * 100));
}

export default function InfluencerDashboard() {
  const params = useParams();
  const code = params.code as string;
  const { affiliate: authAffiliate, authenticated, setAuth, clearAuth } = useInfluencerAuth();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [settlementPdfErr, setSettlementPdfErr] = useState('');
  const [coBrandCopied, setCoBrandCopied] = useState(false);

  const fetchDashboard = useCallback(async (withPin?: string) => {
    setLoading(true);
    setPinError('');
    let pinToSend = withPin;
    if (pinToSend === undefined && typeof window !== 'undefined') {
      try {
        pinToSend = sessionStorage.getItem(`inf_pin_${code}`) ?? undefined;
      } catch {
        pinToSend = undefined;
      }
    }
    try {
      const res = await fetch('/api/influencer/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_code: code, pin: pinToSend }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 401) clearAuth();
        setPinError(json.error || '인증 실패');
        return;
      }

      setData(json);
      if (json.affiliate) {
        setAuth(json.affiliate);
        if (pinToSend) {
          try {
            sessionStorage.setItem(`inf_pin_${code}`, pinToSend);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      setPinError('서버 연결 실패');
    } finally {
      setLoading(false);
    }
  }, [code, setAuth, clearAuth]);

  const openSettlementPdf = useCallback(
    async (settlementId: string, referralCode: string) => {
      setSettlementPdfErr('');
      const storedPin = (() => {
        try {
          return sessionStorage.getItem(`inf_pin_${referralCode}`) || pin || '';
        } catch {
          return pin || '';
        }
      })();
      try {
        const res = await fetch(`/api/settlements/${settlementId}/pdf`, {
          headers: {
            'x-referral-code': referralCode,
            'x-pin': storedPin.replace(/\D/g, '').slice(0, 4),
          },
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setSettlementPdfErr((j as { error?: string }).error || `열기 실패 (${res.status})`);
          return;
        }
        const html = await res.text();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank', 'noopener,noreferrer');
        if (!w) setSettlementPdfErr('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요.');
        else setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        setSettlementPdfErr('네트워크 오류');
      }
    },
    [pin],
  );

  // 인증 완료 상태면 자동 로드
  useEffect(() => {
    if (authenticated && authAffiliate) {
      fetchDashboard();
    }
  }, [authenticated, authAffiliate, fetchDashboard]);

  // ── PIN 인증 화면 ──
  if (!authenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🔐</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">파트너 인증</h1>
            <p className="text-sm text-gray-500 mt-1">등록된 전화번호 뒷자리 4자리를 입력하세요</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">파트너 코드</label>
              <div className="mt-1 px-3 py-2.5 bg-gray-50 rounded-lg text-sm font-mono font-bold text-blue-600">{code}</div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">PIN (4자리)</label>
              <input
                type="password"
                maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && pin.length === 4 && fetchDashboard(pin)}
                className="mt-1 w-full px-3 py-2.5 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] font-bold focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="••••"
                autoFocus
              />
            </div>
            {pinError && <p className="text-red-500 text-sm text-center">{pinError}</p>}
            <button
              onClick={() => fetchDashboard(pin)}
              disabled={pin.length !== 4 || loading}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '확인 중...' : '로그인'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 로딩 ──
  if (!data) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-28 bg-white rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const { affiliate: aff, stats, settlements, recent_bookings, contents, content_revenue, co_brand, attribution_notice } = data;
  const PLATFORM_ICON: Record<string, string> = {
    blog_body: '📝',
    instagram_caption: '📷',
    threads_post: '🧵',
    meta_ads: '📣',
    naver_blog: '🟢',
  };
  const PLATFORM_LABEL: Record<string, string> = {
    blog_body: '블로그',
    instagram_caption: '인스타',
    threads_post: '스레드',
    meta_ads: 'Meta',
    naver_blog: '네이버',
  };
  const totalContentRevenue = (content_revenue || []).reduce((s, c) => s + (c.revenue || 0), 0);
  const totalContentBookings = (content_revenue || []).reduce((s, c) => s + (c.bookings || 0), 0);
  const progress = getGradeProgress(aff.grade, aff.booking_count);

  const STATUS_MAP: Record<string, { label: string; color: string }> = {
    PENDING: { label: '이월', color: 'bg-yellow-100 text-yellow-700' },
    READY: { label: '정산대기', color: 'bg-blue-100 text-blue-700' },
    HOLD: { label: '보류', color: 'bg-orange-100 text-orange-700' },
    COMPLETED: { label: '지급완료', color: 'bg-green-100 text-green-700' },
    VOID: { label: '무효', color: 'bg-gray-100 text-gray-500' },
    CANCELLED: { label: '취소', color: 'bg-gray-100 text-gray-500' },
  };

  // 누적 이월 잔액 계산
  const pendingBalance = settlements
    .filter(s => s.status === 'PENDING')
    .reduce((sum, s) => sum + (s.gross_amount || 0), 0);
  const readyBalance = settlements
    .filter(s => s.status === 'READY')
    .reduce((sum, s) => sum + (s.net_payout || 0), 0);

  return (
    <div className="space-y-6">
      {attribution_notice && (
        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 leading-relaxed">
          {attribution_notice}
        </p>
      )}

      {/* 코브랜딩 랜딩 링크 (바이오용) */}
      {co_brand && (
        <div className="bg-gradient-to-r from-emerald-900 to-teal-900 rounded-xl p-5 text-white shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="font-bold text-lg">내 전용 랜딩</h2>
              <p className="text-xs text-emerald-100 mt-1">SNS 프로필에 걸기 좋은 주소 · 최근 30일 방문 {co_brand.landing_views_30d}회</p>
              <p className="text-[11px] font-mono mt-2 break-all opacity-90">{co_brand.full_url || co_brand.path}</p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const t = co_brand.full_url || (typeof window !== 'undefined' ? `${window.location.origin}${co_brand.path}` : co_brand.path);
                  void navigator.clipboard.writeText(t).then(() => {
                    setCoBrandCopied(true);
                    window.setTimeout(() => setCoBrandCopied(false), 2500);
                  }).catch(() => {});
                }}
                className="px-3 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium border border-white/30"
              >
                {coBrandCopied ? '복사됨 ✓' : 'URL 복사'}
              </button>
              <a
                href={co_brand.full_url || co_brand.path}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 bg-white text-emerald-900 rounded-lg text-sm font-bold hover:bg-emerald-50"
              >
                미리보기
              </a>
              <a
                href="/legal/partner-attribution"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-sm text-emerald-100 underline hover:text-white"
              >
                추적 안내
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI 카드 4개 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="총 예약 건수" value={`${aff.booking_count}건`} icon="📦" sub={`커미션율 ${aff.grade_rate}`} />
        <KPICard label="누적 커미션" value={`₩${(aff.total_commission || 0).toLocaleString()}`} icon="💰" sub={aff.payout_type === 'PERSONAL' ? '3.3% 원천징수' : '세금계산서'} />
        <KPICard label="생성 링크" value={`${stats.total_links}개`} icon="🔗" sub={`클릭 ${stats.total_clicks}회`} />
        <KPICard label="전환율" value={stats.conversion_rate} icon="📈" sub={`전환 ${stats.total_conversions}건`} />
      </div>

      {/* ── 등급 & 진행률 ── */}
      <div className="bg-white rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold text-gray-900">등급 현황</h2>
            <p className="text-sm text-gray-500">{aff.next_grade}</p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-extrabold text-blue-600">{aff.grade_label}</span>
            <p className="text-xs text-gray-400">보너스 +{aff.bonus_rate}%</p>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div
            className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1 text-right">{progress}%</p>
      </div>

      {/* ── 콘텐츠별 매출 기여도 ── */}
      {contents && contents.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold text-gray-900">내가 만든 콘텐츠 성과</h2>
              <p className="text-xs text-gray-500">총 {contents.length}개 콘텐츠 / {totalContentBookings}건 예약 / ₩{totalContentRevenue.toLocaleString()}</p>
            </div>
            <a href={`/influencer/${aff.referral_code}/create-content`} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg font-medium hover:bg-blue-100">
              + 새 콘텐츠
            </a>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {contents.slice(0, 10).map(c => {
              const rev = (content_revenue || []).find(r => r.content_id === c.id);
              return (
                <div key={c.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-lg">{PLATFORM_ICON[c.platform] || '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {PLATFORM_LABEL[c.platform] || c.platform}
                      <span className="ml-2 text-[10px] text-gray-400">{c.status}</span>
                    </p>
                    <p className="text-xs text-gray-400">{c.created_at?.slice(0, 10)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-green-600">+₩{(rev?.commission || 0).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400">{rev?.bookings || 0}건 / 매출 ₩{(rev?.revenue || 0).toLocaleString()}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 월간 리더보드 (익명화) ── */}
      <Leaderboard anonymized title="이번달 TOP 인플루언서" />

      {/* ── 정산 내역 + 최근 예약 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 정산 */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-bold text-gray-900">정산 내역</h2>
              {settlementPdfErr ? (
                <p className="text-[11px] text-red-600 mt-1">{settlementPdfErr}</p>
              ) : null}
            </div>
            {(pendingBalance > 0 || readyBalance > 0) && (
              <div className="text-right">
                {pendingBalance > 0 && (
                  <p className="text-[11px] text-gray-500">이월 잔액: <span className="font-medium text-amber-600">₩{pendingBalance.toLocaleString()}</span></p>
                )}
                {readyBalance > 0 && (
                  <p className="text-[11px] text-gray-500">지급 대기: <span className="font-medium text-blue-600">₩{readyBalance.toLocaleString()}</span></p>
                )}
              </div>
            )}
          </div>
          {settlements.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">아직 정산 내역이 없습니다</p>
          ) : (
            <div className="space-y-2">
              {settlements.map(s => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{s.period}</span>
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_MAP[s.status]?.color || ''}`}>
                      {STATUS_MAP[s.status]?.label || s.status}
                    </span>
                    {(s.status === 'COMPLETED' || s.status === 'READY') && (
                      <button
                        type="button"
                        onClick={() => openSettlementPdf(s.id, aff.referral_code)}
                        className="ml-2 text-[10px] text-blue-500 hover:underline"
                      >
                        내역서
                      </button>
                    )}
                  </div>
                  <span className="text-sm font-bold text-gray-900">₩{(s.net_payout || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 최근 예약 */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <h2 className="font-bold text-gray-900 mb-3">최근 예약</h2>
          {recent_bookings.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">아직 연결된 예약이 없습니다</p>
          ) : (
            <div className="space-y-2">
              {recent_bookings.map(b => (
                <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{b.product_name || '상품'}</p>
                    <p className="text-xs text-gray-400">{b.created_at?.slice(0, 10)}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600 shrink-0 ml-2">
                    +₩{(b.influencer_commission || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── KPI 카드 ──
function KPICard({ label, value, icon, sub }: { label: string; value: string; icon: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase">{label}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="text-xl font-extrabold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
