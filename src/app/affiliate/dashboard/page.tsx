'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/* ── 타입 정의 ── */
interface AffiliateInfo {
  id: string;
  name: string;
  referral_code: string;
  branding_level: string;
  content_quota: number;
  content_used: number;
}

interface AffiliateProfile {
  name: string;
  referral_code: string;
  grade: number | null;
  bonus_rate: number | null;
  branding_level: string;
  content_quota: number;
  content_used: number;
  total_commission: number;
  booking_count: number;
  last_conversion_at: string | null;
}

interface Settlement {
  id: string;
  settlement_period: string;
  status: string;
  total_amount: number | null;
  final_payout: number | null;
  settled_at: string | null;
}

interface Insight {
  id: string;
  insight_type: string;
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

interface DashboardStats {
  affiliate: AffiliateProfile;
  total_views: number;
  total_clicks: number;
  total_revenue: number;
  pending_revenue: number;
  recent_card_news: Array<{
    id: string;
    title_slides: any;
    created_at: string;
    views: number;
    clicks: number;
    status: string;
  }>;
  settlements: Settlement[];
  insights: Insight[];
  booking_trend: Array<{
    date: string;
    bookings: number;
    revenue: number;
  }>;
}

/* ── 메인 페이지 ── */
export default function AffiliateDashboardPage() {
  const router = useRouter();
  const [info, setInfo] = useState<AffiliateInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'settlements' | 'insights' | 'profile'>('overview');

  useEffect(() => {
    const stored = localStorage.getItem('affiliate_info');
    if (!stored) {
      router.replace('/affiliate/login');
      return;
    }
    setInfo(JSON.parse(stored));
  }, [router]);

  const loadStats = useCallback(async () => {
    const token = localStorage.getItem('affiliate_token');
    if (!token) return;
    try {
      const res = await fetch('/api/affiliate/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setStats(json);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleLogout = () => {
    localStorage.removeItem('affiliate_token');
    localStorage.removeItem('affiliate_info');
    router.replace('/affiliate/login');
  };

  if (!info) return null;

  const profile = stats?.affiliate;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── 상단바 ─── */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">Y</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">파트너 대시보드</h1>
              <p className="text-[10px] text-gray-400">{info.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/affiliate/card-news/new"
              className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition-colors"
            >
              + 카드뉴스 생성
            </a>
            <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* ─── 탭 네비게이션 ─── */}
        <TabNav active={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'overview' && (
          <OverviewTab stats={stats} profile={profile} info={info} />
        )}

        {activeTab === 'settlements' && (
          <SettlementsTab settlements={stats?.settlements ?? []} totalCommission={profile?.total_commission ?? 0} bookingCount={profile?.booking_count ?? 0} />
        )}

        {activeTab === 'insights' && (
          <InsightsTab insights={stats?.insights ?? []} />
        )}

        {activeTab === 'profile' && (
          <ProfileTab profile={profile} referralCode={info.referral_code} />
        )}
      </main>
    </div>
  );
}

/* ─── 탭 네비게이션 ─── */
function TabNav({ active, onTabChange }: { active: string; onTabChange: (t: 'overview' | 'settlements' | 'insights' | 'profile') => void }) {
  const tabs = [
    { key: 'overview' as const, label: '개요', icon: '📊' },
    { key: 'settlements' as const, label: '정산내역', icon: '💰' },
    { key: 'insights' as const, label: 'AI 인사이트', icon: '💡' },
    { key: 'profile' as const, label: '프로필', icon: '👤' },
  ];

  return (
    <div className="flex gap-1 bg-white rounded-xl border p-1">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`flex-1 py-2.5 text-xs rounded-lg font-medium transition-all ${
            active === tab.key
              ? 'bg-amber-500 text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="mr-1">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ─── 개요 탭 ─── */
function OverviewTab({ stats, profile, info }: { stats: DashboardStats | null; profile: AffiliateProfile | undefined; info: AffiliateInfo }) {
  const quotaPct = info.content_quota > 0 ? Math.round((info.content_used / info.content_quota) * 100) : 0;

  return (
    <>
      {/* 성과 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="조회수" value={stats?.total_views ?? 0} icon="👁️" />
        <SummaryCard label="클릭" value={stats?.total_clicks ?? 0} icon="🖱️" />
        <SummaryCard label="정산 완료" value={`${(stats?.total_revenue ?? 0).toLocaleString()}원`} icon="💰" />
        <SummaryCard label="정산 대기" value={`${(stats?.pending_revenue ?? 0).toLocaleString()}원`} icon="⏳" />
        <SummaryCard label="등급" value={profile?.grade ? `${'⭐'.repeat(profile.grade)}` : '-'} icon="🏅" />
      </div>

      {/* 최근 콘텐츠 + 할당량 */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 콘텐츠 현황 */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">최근 콘텐츠</h2>
            <a href="/affiliate/card-news" className="text-xs text-amber-600 hover:text-amber-700">
              전체보기 →
            </a>
          </div>

          {/* 할당량 게이지 */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>이번 달 생성량</span>
              <span>{info.content_used} / {info.content_quota}회</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  quotaPct >= 90 ? 'bg-red-500' : quotaPct >= 70 ? 'bg-amber-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.min(quotaPct, 100)}%` }}
              />
            </div>
          </div>

          {stats?.recent_card_news && stats.recent_card_news.length > 0 ? (
            <div className="space-y-2">
              {stats.recent_card_news.slice(0, 5).map(cn => (
                <a
                  key={cn.id}
                  href={`/affiliate/card-news/${cn.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {cn.title_slides?.[0]?.title || '제목 없음'}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {new Date(cn.created_at).toLocaleDateString()} · 조회 {cn.views ?? 0}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">{cn.clicks ?? 0}클릭</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p className="text-sm">아직 생성한 콘텐츠가 없습니다.</p>
              <a
                href="/affiliate/card-news/new"
                className="inline-block mt-2 text-xs text-amber-600 hover:text-amber-700 underline"
              >
                첫 카드뉴스 만들기 →
              </a>
            </div>
          )}
        </div>

        {/* 7일 트렌드 */}
        {stats?.booking_trend && stats.booking_trend.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-4">최근 7일 활동</h2>
            <div className="flex items-end gap-2 h-28">
              {stats.booking_trend.map((day) => {
                const max = Math.max(...stats.booking_trend.map(d => d.bookings), 1);
                const h = (day.bookings / max) * 100;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-gray-400 font-medium">{day.bookings}</span>
                    <div className="w-full bg-amber-50 rounded-t relative flex-1 self-stretch">
                      <div
                        className="absolute bottom-0 w-full bg-gradient-to-t from-amber-500 to-amber-400 rounded-t transition-all"
                        style={{ height: `${Math.max(h, 8)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-gray-400">
                      {new Date(day.date).toLocaleDateString('ko-KR', { weekday: 'short' })}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-3 text-center">카드뉴스 생성 기준</p>
          </div>
        )}
      </div>

      {/* 최근 인사이트 (요약) */}
      {stats?.insights && stats.insights.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">💡 AI 인사이트</h2>
            <button
              onClick={() => {/* 부모의 setActiveTab 호출 불가 - 별도 컴포넌트 */}}
              className="text-xs text-amber-600 hover:text-amber-700"
            >
              더보기 →
            </button>
          </div>
          <div className="space-y-2">
            {stats.insights.slice(0, 3).map(ins => (
              <div key={ins.id} className="p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-start gap-2">
                  <span className="text-base mt-0.5">
                    {ins.insight_type === 'performance_tip' ? '📈' :
                     ins.insight_type === 'template_recommendation' ? '🎨' :
                     ins.insight_type === 'topic_suggestion' ? '💡' :
                     ins.insight_type === 'timing_optimization' ? '⏰' : '📋'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900">{ins.title}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{ins.content}</p>
                    <p className="text-[9px] text-gray-400 mt-1">{new Date(ins.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─── 정산내역 탭 ─── */
function SettlementsTab({ settlements, totalCommission, bookingCount }: { settlements: Settlement[]; totalCommission: number; bookingCount: number }) {
  const statusLabel = (s: string) => {
    switch (s) {
      case 'COMPLETED': return { text: '지급 완료', class: 'bg-green-100 text-green-700' };
      case 'READY': return { text: '정산 확정', class: 'bg-blue-100 text-blue-700' };
      case 'PENDING': return { text: '대기', class: 'bg-gray-100 text-gray-500' };
      default: return { text: s, class: 'bg-gray-100 text-gray-500' };
    }
  };

  return (
    <>
      {/* 누적 요약 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border p-5">
          <p className="text-[10px] text-gray-400 mb-1">누적 정산 완료</p>
          <p className="text-xl font-bold text-gray-900">{totalCommission.toLocaleString()}원</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-[10px] text-gray-400 mb-1">누적 정산 예약건</p>
          <p className="text-xl font-bold text-gray-900">{bookingCount}건</p>
        </div>
      </div>

      {/* 정산 내역 테이블 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900 text-sm">정산 내역</h2>
        </div>
        {settlements.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-left px-5 py-3 font-medium">정산월</th>
                  <th className="text-right px-5 py-3 font-medium">정산액</th>
                  <th className="text-right px-5 py-3 font-medium">실지급액</th>
                  <th className="text-center px-5 py-3 font-medium">상태</th>
                  <th className="text-center px-5 py-3 font-medium">지급일</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {settlements.map(s => {
                  const st = statusLabel(s.status);
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{s.settlement_period}</td>
                      <td className="px-5 py-3 text-right">{(s.total_amount ?? 0).toLocaleString()}원</td>
                      <td className="px-5 py-3 text-right">{(s.final_payout ?? 0).toLocaleString()}원</td>
                      <td className="px-5 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${st.class}`}>{st.text}</span>
                      </td>
                      <td className="px-5 py-3 text-center text-gray-400">
                        {s.settled_at ? new Date(s.settled_at).toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-gray-400 text-sm">
            아직 정산 내역이 없습니다.
          </div>
        )}
      </div>
    </>
  );
}

/* ─── 인사이트 탭 ─── */
function InsightsTab({ insights }: { insights: Insight[] }) {
  const typeIcon = (t: string) => {
    switch (t) {
      case 'performance_tip': return { icon: '📈', label: '성과 팁' };
      case 'template_recommendation': return { icon: '🎨', label: '템플릿 추천' };
      case 'topic_suggestion': return { icon: '💡', label: '주제 제안' };
      case 'timing_optimization': return { icon: '⏰', label: '발행 최적 시간' };
      case 'summary_report': return { icon: '📋', label: '요약 리포트' };
      default: return { icon: '📌', label: t };
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 text-sm">💡 AI 콘텐츠 인사이트</h2>
        <span className="text-[10px] text-gray-400">성과 데이터 기반 자동 분석</span>
      </div>
      {insights.length > 0 ? (
        <div className="space-y-2">
          {insights.map(ins => {
            const ti = typeIcon(ins.insight_type);
            return (
              <div key={ins.id} className="bg-white rounded-xl border p-4 hover:border-amber-200 transition-colors">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">{ti.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        {ti.label}
                      </span>
                      <span className="text-[9px] text-gray-400">
                        {new Date(ins.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 mb-1">{ins.title}</p>
                    <p className="text-xs text-gray-600 leading-relaxed">{ins.content}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-10 text-center">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-sm text-gray-400">아직 충분한 데이터가 쌓이지 않았습니다.</p>
          <p className="text-[11px] text-gray-400 mt-1">카드뉴스를 생성하고 성과가 쌓이면 AI 인사이트가 자동으로 제공됩니다.</p>
        </div>
      )}
    </div>
  );
}

/* ─── 프로필 탭 ─── */
function ProfileTab({ profile, referralCode }: { profile: AffiliateProfile | undefined; referralCode: string }) {
  if (!profile) return null;

  const gradeLabel = (g: number | null) => {
    switch (g) {
      case 1: return { label: '브론즈', color: 'text-amber-700' };
      case 2: return { label: '실버', color: 'text-gray-500' };
      case 3: return { label: '골드', color: 'text-yellow-600' };
      case 4: return { label: '플래티넘', color: 'text-gray-700' };
      case 5: return { label: '다이아몬드', color: 'text-blue-600' };
      default: return { label: '-', color: 'text-gray-400' };
    }
  };

  const gl = gradeLabel(profile.grade);
  const brandingLabel = profile.branding_level === 'white_label' ? '화이트라벨' :
    profile.branding_level === 'co_brand' ? '코브랜딩' : '파워드바이';

  return (
    <div className="space-y-4">
      {/* 기본 정보 */}
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm">기본 정보</h2>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-gray-400 mb-1">이름</p>
            <p className="font-medium text-gray-900">{profile.name}</p>
          </div>
          <div>
            <p className="text-gray-400 mb-1">추천인 코드</p>
            <p className="font-mono font-medium text-gray-900">{referralCode}</p>
          </div>
          <div>
            <p className="text-gray-400 mb-1">등급</p>
            <p className={`font-medium ${gl.color}`}>{'⭐'.repeat(profile.grade ?? 1)} {gl.label}</p>
          </div>
          <div>
            <p className="text-gray-400 mb-1">보너스율</p>
            <p className="font-medium text-gray-900">{profile.bonus_rate ? `${(profile.bonus_rate * 100).toFixed(1)}%` : '-'}</p>
          </div>
          <div>
            <p className="text-gray-400 mb-1">브랜딩 레벨</p>
            <p className="font-medium text-gray-900">{brandingLabel}</p>
          </div>
          <div>
            <p className="text-gray-400 mb-1">마지막 전환</p>
            <p className="font-medium text-gray-900">
              {profile.last_conversion_at ? new Date(profile.last_conversion_at).toLocaleDateString() : '없음'}
            </p>
          </div>
        </div>
      </div>

      {/* 파트너 포털 접속 정보 */}
      <div className="bg-white rounded-xl border p-5 space-y-3">
        <h2 className="font-semibold text-gray-900 text-sm">파트너 포털</h2>
        <div className="text-xs text-gray-600 space-y-2">
          <p>파트너 포털 로그인 URL:</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/affiliate/login`}
              className="flex-1 bg-gray-50 border rounded-lg px-3 py-2 text-xs text-gray-500"
              onFocus={e => e.target.select()}
            />
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-800">
            <p className="font-medium mb-1">🔑 로그인 방법</p>
            <p>추천인 코드(<strong>{referralCode}</strong>)와 관리자가 설정한 PIN 번호로 로그인할 수 있습니다.</p>
            <p className="mt-1">PIN 번호는 관리자에게 문의하세요.</p>
          </div>
        </div>
      </div>

      {/* 할당량 정보 */}
      <div className="bg-white rounded-xl border p-5 space-y-3">
        <h2 className="font-semibold text-gray-900 text-sm">콘텐츠 할당량</h2>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-gray-500">
            <span>이번 달 사용량</span>
            <span>{profile.content_used} / {profile.content_quota}회</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-amber-500 transition-all"
              style={{ width: `${Math.min((profile.content_used / Math.max(profile.content_quota, 1)) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 요약 카드 ─── */
function SummaryCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-gray-400">{label}</span>
      </div>
      <p className="text-base font-bold text-gray-900">{value}</p>
    </div>
  );
}
