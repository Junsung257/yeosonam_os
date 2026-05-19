/**
 * 광고 자동화 상태 어드민 페이지.
 *
 * 사장님이 한 화면에서 자동화 상태를 진단:
 *   - 3 플랫폼 키 등록 여부
 *   - 자동 실행 토글 (dry-run / apply)
 *   - 광고 계정 잔액 + 일일 예산
 *   - 키워드 통계 (ACTIVE / PAUSED / FLAGGED_UP / 롱테일)
 *   - 오늘 광고 지출·매출·순익
 *   - 최근 잔액 알림 5건
 *   - Google Ads OAuth 시작 버튼 (사장님이 한 번 방문 후 refresh_token 발급)
 */

import Link from 'next/link';
import { headers } from 'next/headers';

interface StatusResponse {
  ok: boolean;
  mock?: boolean;
  credentials: { meta: boolean; naver: boolean; google: boolean };
  toggles: {
    applyChanges: boolean;
    applyOffpeakRule: boolean;
    roasTargetPct: number;
    flagUpBidFactor: number;
    offpeakBidFactor: number;
    minBidKrw: number;
    longtailCpcMax: number;
  };
  accounts?: Array<{
    platform: string;
    accountName: string;
    currentBalance: number;
    lowBalanceThreshold: number;
    dailyBudget: number;
    lastSyncedAt: string | null;
    isActive: boolean;
    belowThreshold: boolean;
  }>;
  keywordStats?: {
    total: number;
    byStatus: Record<string, number>;
    byPlatform: Record<string, number>;
    longtail: number;
  };
  todayStats?: {
    totalSpend: number;
    totalRevenue: number;
    totalNetProfit: number;
    avgRoas: number;
  };
  recentBalanceAlerts?: Array<{
    id: string;
    severity: string;
    title: string;
    message: string;
    created_at: string;
  }>;
}

async function fetchStatus(): Promise<StatusResponse | null> {
  try {
    const h = await headers();
    const host = h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    const res = await fetch(`${proto}://${host}/api/admin/ads-automation/status`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function CredentialBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
      }`}
    >
      <span className="text-lg leading-none">{ok ? '✓' : '✗'}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="ml-auto text-xs">{ok ? '등록됨' : '키 필요'}</span>
    </div>
  );
}

export default async function AdsAutomationPage() {
  const status = await fetchStatus();

  if (!status) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">광고 자동화 상태</h1>
        <p className="mt-4 text-red-600">상태 조회 실패 — /api/admin/ads-automation/status 응답 없음.</p>
      </div>
    );
  }

  const { credentials, toggles, accounts = [], keywordStats, todayStats, recentBalanceAlerts = [] } = status;

  const credsCount = [credentials.meta, credentials.naver, credentials.google].filter(Boolean).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">광고 자동화 상태</h1>
          <p className="mt-1 text-sm text-gray-600">시간당 cron · ROAS 기준 자동 PAUSE/BID · 새벽 입찰 감액 · 롱테일 발굴</p>
        </div>
        <Link
          href="/admin/marketing"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          ← 마케팅 허브
        </Link>
      </div>

      {/* 자동화 작동 모드 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">자동화 작동 모드</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div
            className={`rounded-lg border p-3 ${
              toggles.applyChanges ? 'border-rose-300 bg-rose-50' : 'border-blue-200 bg-blue-50'
            }`}
          >
            <div className="text-xs text-gray-600">AD_OPTIMIZER_APPLY_CHANGES</div>
            <div className={`mt-1 text-lg font-bold ${toggles.applyChanges ? 'text-rose-700' : 'text-blue-700'}`}>
              {toggles.applyChanges ? '🔴 풀자동 (실제 적용)' : '🟢 dry-run (로그만)'}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-600">APPLY_OFFPEAK_RULE</div>
            <div className="mt-1 text-lg font-bold">{toggles.applyOffpeakRule ? '✓ 새벽 감액 ON' : '✗ OFF'}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-600">ROAS 목표</div>
            <div className="mt-1 text-lg font-bold">{toggles.roasTargetPct}%</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-600">FLAG_UP 배수 / OFFPEAK 배수</div>
            <div className="mt-1 text-base font-semibold">
              ↑ {toggles.flagUpBidFactor}× / ↓ {toggles.offpeakBidFactor}×
            </div>
          </div>
        </div>
        {!toggles.applyChanges && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            현재 dry-run 모드입니다. 외부 광고 플랫폼은 변경되지 않고 DB·로그만 갱신됩니다. 풀자동 전환은 Vercel env 에서{' '}
            <code className="rounded bg-amber-100 px-1">AD_OPTIMIZER_APPLY_CHANGES=true</code>로 설정.
          </p>
        )}
      </section>

      {/* 3 플랫폼 키 등록 상태 */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">
          플랫폼 키 등록 상태 <span className="text-sm font-normal text-gray-500">({credsCount}/3)</span>
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <CredentialBadge ok={credentials.meta} label="Meta (META_ACCESS_TOKEN 외 2개)" />
          <CredentialBadge ok={credentials.naver} label="네이버 (NAVER_AD_* 3개)" />
          <CredentialBadge ok={credentials.google} label="구글 (GOOGLE_ADS_* 5개)" />
        </div>
        {!credentials.google && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
            <strong className="text-gray-700">구글 Ads refresh_token 발급:</strong>
            <ol className="ml-4 mt-1 list-decimal space-y-0.5 text-gray-600">
              <li>Google Ads Manager → API 센터 → Basic Access 신청 (3~14일 승인)</li>
              <li>승인 후 console.cloud.google.com 에서 OAuth 클라이언트 생성</li>
              <li>Vercel env 에 GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET 등록</li>
              <li>아래 버튼 클릭 → Google 로그인 → refresh_token 자동 저장</li>
            </ol>
          </div>
        )}
      </section>

      {/* 광고 계정 잔액 */}
      {accounts.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">광고 계정 잔액</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-gray-500">
                  <th className="py-2">플랫폼</th>
                  <th>계정명</th>
                  <th className="text-right">잔액</th>
                  <th className="text-right">임계값</th>
                  <th className="text-right">일일 예산</th>
                  <th>마지막 동기화</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.platform + a.accountName} className="border-b last:border-b-0">
                    <td className="py-2 font-medium uppercase">{a.platform}</td>
                    <td>{a.accountName}</td>
                    <td
                      className={`text-right font-mono ${a.belowThreshold ? 'font-bold text-rose-600' : ''}`}
                    >
                      ₩{fmt(a.currentBalance)}
                      {a.belowThreshold && <span className="ml-1 text-xs">⚠</span>}
                    </td>
                    <td className="text-right font-mono text-gray-500">₩{fmt(a.lowBalanceThreshold)}</td>
                    <td className="text-right font-mono">₩{fmt(a.dailyBudget)}</td>
                    <td className="text-xs text-gray-500">
                      {a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString('ko-KR') : '미동기화'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 키워드 통계 */}
      {keywordStats && keywordStats.total > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">키워드 통계 (총 {keywordStats.total}개)</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg bg-emerald-50 p-3">
              <div className="text-xs text-emerald-700">ACTIVE</div>
              <div className="text-2xl font-bold text-emerald-700">{keywordStats.byStatus.ACTIVE ?? 0}</div>
            </div>
            <div className="rounded-lg bg-rose-50 p-3">
              <div className="text-xs text-rose-700">PAUSED</div>
              <div className="text-2xl font-bold text-rose-700">{keywordStats.byStatus.PAUSED ?? 0}</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <div className="text-xs text-amber-700">FLAGGED_UP</div>
              <div className="text-2xl font-bold text-amber-700">{keywordStats.byStatus.FLAGGED_UP ?? 0}</div>
            </div>
            <div className="rounded-lg bg-violet-50 p-3">
              <div className="text-xs text-violet-700">롱테일</div>
              <div className="text-2xl font-bold text-violet-700">{keywordStats.longtail}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-700">플랫폼 분포</div>
              <div className="text-sm font-semibold">
                N {keywordStats.byPlatform.naver ?? 0} / G {keywordStats.byPlatform.google ?? 0} / M{' '}
                {keywordStats.byPlatform.meta ?? 0}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 오늘 광고 지출 */}
      {todayStats && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">오늘 광고 성과</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-600">광고 지출</div>
              <div className="mt-1 font-mono text-xl font-bold">₩{fmt(todayStats.totalSpend)}</div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <div className="text-xs text-blue-700">전환 매출</div>
              <div className="mt-1 font-mono text-xl font-bold text-blue-700">₩{fmt(todayStats.totalRevenue)}</div>
            </div>
            <div
              className={`rounded-lg p-3 ${todayStats.totalNetProfit >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}
            >
              <div className={`text-xs ${todayStats.totalNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                순익
              </div>
              <div
                className={`mt-1 font-mono text-xl font-bold ${
                  todayStats.totalNetProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                ₩{fmt(todayStats.totalNetProfit)}
              </div>
            </div>
            <div
              className={`rounded-lg p-3 ${
                todayStats.avgRoas >= toggles.roasTargetPct ? 'bg-emerald-50' : 'bg-amber-50'
              }`}
            >
              <div
                className={`text-xs ${
                  todayStats.avgRoas >= toggles.roasTargetPct ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                평균 ROAS
              </div>
              <div
                className={`mt-1 font-mono text-xl font-bold ${
                  todayStats.avgRoas >= toggles.roasTargetPct ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {todayStats.avgRoas}%
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 최근 잔액 알림 */}
      {recentBalanceAlerts.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">최근 잔액 알림</h2>
          <ul className="space-y-2 text-sm">
            {recentBalanceAlerts.map((alert) => (
              <li key={alert.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <span className={alert.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'}>●</span>
                <div className="flex-1">
                  <div className="font-medium">{alert.title}</div>
                  <div className="text-xs text-gray-600">{alert.message}</div>
                </div>
                <time className="text-xs text-gray-500">
                  {new Date(alert.created_at).toLocaleString('ko-KR')}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
