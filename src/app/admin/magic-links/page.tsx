'use client';

/**
 * 어드민 매직링크 관리 — `/admin/magic-links`.
 *
 * 기능:
 *   1) 새 매직링크 발급 (action_type, booking_id, TTL, metadata)
 *   2) 발급 직후 rawToken + URL 1회 노출 + 복사 버튼
 *   3) 최근 발급 목록 (booking_id 필터)
 *   4) 폐기 버튼
 *
 * 발송 (알림톡/SMS) 은 아직 미연동 — 발급 후 "복사해서 카카오톡 등으로 수동 공유" 안내.
 */

import { useEffect, useState } from 'react';

type ActionType =
  | 'booking_portal'
  | 'guidebook'
  | 'itinerary_consent'
  | 'passport_upload'
  | 'review_request'
  | 'companion_input'
  | 'jarvis_session';

const ACTION_LABELS: Record<ActionType, string> = {
  booking_portal: '예약 정보 조회',
  guidebook: '가이드북',
  itinerary_consent: '일정 변경 동의',
  passport_upload: '여권 정보 등록',
  review_request: '리뷰·후기 작성',
  companion_input: '동반자 정보 입력',
  jarvis_session: '자비스 상담 채팅',
};

const DEFAULT_TTL_HOURS: Record<ActionType, number> = {
  booking_portal: 24 * 14,
  guidebook: 24 * 14,
  itinerary_consent: 48,
  passport_upload: 24 * 7,
  review_request: 24 * 30,
  companion_input: 24 * 7,
  jarvis_session: 24,
};

interface Metrics {
  windowDays: number;
  mintedCount: number;
  confirmedCount: number;
  consumedCount: number;
  revokedCount: number;
  expiredActive: number;
  confirmRate: number;
  consumeRate: number;
  byAction: Record<string, { minted: number; confirmed: number; consumed: number }>;
  byChannel: Record<string, number>;
}

interface TokenRow {
  id: string;
  action_type: ActionType;
  booking_id: string | null;
  metadata: Record<string, unknown> | null;
  recipient_channel: string | null;
  single_use: boolean;
  confirm_required: boolean;
  confirmed_at: string | null;
  used_at: string | null;
  use_count: number;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
}

interface MintResponse {
  tokenId: string;
  rawToken: string;
  url: string;
  expiresAt: string;
  dispatch?: {
    delivered: boolean;
    channelUsed: 'alimtalk' | 'sms' | 'email' | 'mock';
    isMock: boolean;
    reason?: string;
  } | null;
}

export default function AdminMagicLinksPage() {
  const [actionType, setActionType] = useState<ActionType>('booking_portal');
  const [bookingId, setBookingId] = useState('');
  const [ttlHours, setTtlHours] = useState<number>(DEFAULT_TTL_HOURS.booking_portal);
  const [metadataJson, setMetadataJson] = useState('{}');
  const [recipientChannel, setRecipientChannel] = useState('manual_share');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [filterBookingId, setFilterBookingId] = useState('');

  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState<MintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [customLabel, setCustomLabel] = useState('');

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // action_type 변경 시 default TTL
  useEffect(() => {
    setTtlHours(DEFAULT_TTL_HOURS[actionType]);
  }, [actionType]);

  const loadList = async (bid: string = '') => {
    setLoadingList(true);
    try {
      const q = bid ? `?bookingId=${encodeURIComponent(bid)}&limit=30` : '?limit=30';
      const res = await fetch(`/api/admin/magic-links/list${q}`);
      const json = await res.json();
      if (res.ok) {
        setTokens(json.tokens ?? []);
      }
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadList();
    fetch('/api/admin/magic-links/metrics?days=7')
      .then((r) => r.json())
      .then((m) => setMetrics(m as Metrics))
      .catch(() => {});
  }, []);

  const mint = async () => {
    setError(null);
    setMintResult(null);

    let metadata: Record<string, unknown> = {};
    try {
      if (metadataJson.trim()) metadata = JSON.parse(metadataJson);
    } catch {
      setError('metadata JSON 형식이 잘못되었어요.');
      return;
    }

    setMinting(true);
    try {
      const res = await fetch('/api/admin/magic-links/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          bookingId: bookingId.trim() || undefined,
          ttlHours,
          metadata,
          recipientChannel,
          recipientPhone: recipientPhone.trim() || undefined,
          dispatch: autoDispatch,
          label: customLabel.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setMintResult(json as MintResponse);
        loadList(filterBookingId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mint_failed');
    } finally {
      setMinting(false);
    }
  };

  const revoke = async (tokenId: string) => {
    if (!confirm('이 매직링크를 폐기하시겠어요? 폐기 후 사용자가 클릭해도 동작하지 않습니다.')) return;
    const reason = prompt('폐기 사유 (선택, 200자 이내)') ?? '';
    const res = await fetch('/api/admin/magic-links/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId, reason: reason || undefined }),
    });
    if (res.ok) {
      loadList(filterBookingId);
    } else {
      alert('폐기 실패');
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">매직링크 관리</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          고객에게 보낼 매직링크를 발급·복사·폐기합니다. 발급 직후에만 원문 토큰이 노출됩니다 — 닫으면 다시 볼 수 없으니 즉시 복사해 주세요.
          알림톡 자동 발송은 KAKAO_TEMPLATE_MAGIC_LINK 환경변수 설정 후 활성화됩니다.
        </p>
      </header>

      {/* 메트릭 카드 */}
      {metrics && (
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MetricCard label="최근 7일 발급" value={metrics.mintedCount.toLocaleString()} />
          <MetricCard
            label="확인 전환율"
            value={`${(metrics.confirmRate * 100).toFixed(1)}%`}
            sub={`${metrics.confirmedCount}/${metrics.mintedCount}`}
          />
          <MetricCard
            label="사용 전환율"
            value={`${(metrics.consumeRate * 100).toFixed(1)}%`}
            sub={`${metrics.consumedCount}/${metrics.confirmedCount}`}
          />
          <MetricCard
            label="만료 (lost)"
            value={metrics.expiredActive.toLocaleString()}
            sub="미사용 만료"
          />
          <MetricCard label="폐기" value={metrics.revokedCount.toLocaleString()} />
        </section>
      )}

      {metrics && Object.keys(metrics.byAction).length > 0 && (
        <section className="bg-white border border-gray-200 rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">액션 종류별 (7일)</h3>
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left py-1.5">액션</th>
                <th className="text-right py-1.5">발급</th>
                <th className="text-right py-1.5">확인</th>
                <th className="text-right py-1.5">완료</th>
                <th className="text-right py-1.5">완료율</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics.byAction).map(([k, v]) => (
                <tr key={k} className="border-b border-gray-100">
                  <td className="py-1.5">{ACTION_LABELS[k as ActionType] ?? k}</td>
                  <td className="text-right">{v.minted}</td>
                  <td className="text-right">{v.confirmed}</td>
                  <td className="text-right">{v.consumed}</td>
                  <td className="text-right text-gray-500">
                    {v.minted ? `${((v.consumed / v.minted) * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 발급 폼 */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <h2 className="font-semibold text-gray-900 mb-4">새 매직링크 발급</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="magic-link-action-type" className="block text-xs text-gray-600 mb-1.5">액션 종류</label>
            <select
              id="magic-link-action-type"
              value={actionType}
              onChange={(e) => setActionType(e.target.value as ActionType)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {(Object.keys(ACTION_LABELS) as ActionType[]).map((k) => (
                <option key={k} value={k}>
                  {ACTION_LABELS[k]} ({k})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="magic-link-booking-id" className="block text-xs text-gray-600 mb-1.5">
              예약 ID {actionType !== 'jarvis_session' && <span className="text-red-500">*</span>}
            </label>
            <input
              id="magic-link-booking-id"
              type="text"
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              placeholder="UUID"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="magic-link-ttl-hours" className="block text-xs text-gray-600 mb-1.5">유효기간 (시간)</label>
            <input
              id="magic-link-ttl-hours"
              type="number"
              min={1}
              max={24 * 365}
              value={ttlHours}
              onChange={(e) => setTtlHours(Number(e.target.value))}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              기본값: {DEFAULT_TTL_HOURS[actionType]}h ({Math.round(DEFAULT_TTL_HOURS[actionType] / 24)}일)
            </p>
          </div>

          <div>
            <label htmlFor="magic-link-recipient-channel" className="block text-xs text-gray-600 mb-1.5">발송 채널 (감사 기록용)</label>
            <select
              id="magic-link-recipient-channel"
              value={recipientChannel}
              onChange={(e) => setRecipientChannel(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="manual_share">manual_share (수동 복사·공유)</option>
              <option value="alimtalk">alimtalk (알림톡 — wire 후 자동)</option>
              <option value="sms">sms</option>
              <option value="email">email</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="magic-link-recipient-phone" className="block text-xs text-gray-600 mb-1.5">수신자 (전화번호 또는 이메일, 선택)</label>
            <input
              id="magic-link-recipient-phone"
              type="text"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="010-0000-0000 (DB에는 해시만 저장)"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="magic-link-custom-label" className="block text-xs text-gray-600 mb-1.5">발송 메시지 라벨 (선택, 90자 이내)</label>
            <input
              id="magic-link-custom-label"
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="비워두면 액션 종류별 기본 문구 사용"
              maxLength={90}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="sm:col-span-2 flex items-center gap-2">
            <input
              id="autoDispatch"
              type="checkbox"
              checked={autoDispatch}
              onChange={(e) => setAutoDispatch(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="autoDispatch" className="text-sm text-gray-700">
              발급과 동시에 자동 발송 (알림톡 템플릿 미설정 시 mock 로그)
            </label>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="magic-link-metadata" className="block text-xs text-gray-600 mb-1.5">메타데이터 (JSON)</label>
            <textarea
              id="magic-link-metadata"
              value={metadataJson}
              onChange={(e) => setMetadataJson(e.target.value)}
              rows={4}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono"
              placeholder='예) {"changeReason":"항공 시간 변경","summary":"09:00→10:30"}'
            />
            <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
              액션별 예시 — itinerary_consent: <code>{`{ changeReason, summary, details, deadline }`}</code> ·
              companion_input: <code>{`{ leadCustomerName, companionRole, bookingNo }`}</code>
            </p>
          </div>
        </div>

        <button
          onClick={mint}
          disabled={minting}
          className="mt-5 w-full sm:w-auto bg-gray-900 text-white rounded-xl px-6 py-3 text-sm font-semibold hover:bg-gray-800 disabled:opacity-40"
        >
          {minting ? '발급 중…' : '매직링크 발급'}
        </button>

        {error && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {error}
          </div>
        )}

        {mintResult && (
          <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
            <div className="text-sm font-semibold text-emerald-900 mb-2">발급 완료 — 즉시 복사해 공유하세요</div>
            <UrlCopyRow label="URL" value={mintResult.url} />
            <UrlCopyRow label="원문 토큰 (URL 의 마지막 부분)" value={mintResult.rawToken} />
            <p className="text-[11px] text-emerald-800 mt-3 leading-relaxed">
              만료: {new Date(mintResult.expiresAt).toLocaleString('ko-KR')} · 토큰 ID: <code>{mintResult.tokenId}</code>
              <br />
              ⚠ 이 화면을 닫으면 원문은 다시 표시되지 않습니다 (DB에는 SHA-256 해시만 저장).
            </p>
            {mintResult.dispatch && (
              <div className="mt-3 text-xs bg-white border border-emerald-200 rounded p-2.5">
                <span className="font-semibold">발송 결과: </span>
                {mintResult.dispatch.delivered ? (
                  <span className="text-emerald-700">✓ {mintResult.dispatch.channelUsed} 전송 완료</span>
                ) : (
                  <span className="text-amber-700">
                    Mock 로그만 기록됨 ({mintResult.dispatch.reason ?? '환경변수 미설정'}) — message_logs 에 보관됨
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 발급 목록 */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">발급 내역 (최근 30)</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={filterBookingId}
              onChange={(e) => setFilterBookingId(e.target.value)}
              placeholder="bookingId 필터"
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono w-64"
            />
            <button
              onClick={() => loadList(filterBookingId)}
              className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              조회
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left py-2">발급</th>
                <th className="text-left py-2">액션</th>
                <th className="text-left py-2">예약</th>
                <th className="text-left py-2">상태</th>
                <th className="text-left py-2">만료</th>
                <th className="text-left py-2">사용</th>
                <th className="text-right py-2">관리</th>
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-400">
                    불러오는 중…
                  </td>
                </tr>
              ) : tokens.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-400">
                    발급된 매직링크가 없습니다.
                  </td>
                </tr>
              ) : (
                tokens.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-700">
                      {new Date(t.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="py-2">
                      <span className="inline-block bg-gray-100 rounded-full px-2 py-0.5">
                        {ACTION_LABELS[t.action_type] ?? t.action_type}
                      </span>
                    </td>
                    <td className="py-2 font-mono text-[10px] text-gray-500">{t.booking_id?.slice(0, 8) ?? '—'}</td>
                    <td className="py-2">
                      <TokenStatus token={t} />
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(t.expires_at).toLocaleString('ko-KR', { dateStyle: 'short' })}
                    </td>
                    <td className="py-2 text-gray-500">
                      {t.used_at ? '✓ 사용됨' : t.confirmed_at ? '확인됨' : '대기'}
                    </td>
                    <td className="py-2 text-right">
                      {!t.revoked_at && !t.used_at && (
                        <button
                          onClick={() => revoke(t.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          폐기
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-900 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function UrlCopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[10px] text-emerald-800 w-32 flex-shrink-0">{label}</span>
      <input
        readOnly
        value={value}
        className="flex-1 bg-white border border-emerald-200 rounded px-2 py-1 text-[11px] font-mono"
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
        }}
        className="text-[11px] px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
      >
        복사
      </button>
    </div>
  );
}

function TokenStatus({ token }: { token: TokenRow }) {
  if (token.revoked_at) {
    return <span className="text-red-600">폐기됨</span>;
  }
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return <span className="text-gray-400">만료</span>;
  }
  if (token.used_at) {
    return <span className="text-emerald-700">완료</span>;
  }
  if (token.confirmed_at) {
    return <span className="text-amber-700">확인됨</span>;
  }
  return <span className="text-blue-700">대기</span>;
}
