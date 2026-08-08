"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatSettlementTimestamp } from "@/lib/settlement-date-format";

type Settings = {
  state: string;
  profile: {
    name: string;
    referral_code: string;
    partner_status: string;
    payout_profile_status: string;
    tax_profile_status: string;
  };
  channels: Array<{
    id: string;
    channel_type: string;
    channel_url: string;
    display_name: string | null;
    verification_status: string;
  }>;
  domains: Array<{
    id: string;
    hostname: string;
    verification_method: string;
    verification_status: string;
    last_checked_at: string | null;
  }>;
  terms: Array<{
    document_type: string;
    document_version: string;
    accepted_at: string;
  }>;
  active_sessions: Array<{
    id: string;
    issued_at: string;
    expires_at: string;
    last_used_at: string | null;
  }>;
  policy_blockers: Record<string, boolean>;
};

function requestKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
const STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: "미제출",
  PENDING_REVIEW: "검토 중",
  VERIFIED: "확인 완료",
  CHANGES_REQUIRED: "보완 필요",
  LOCKED: "변경 잠금",
  PENDING: "검토 중",
  REJECTED: "반려",
  REVOKED: "해제됨",
  FAILED: "확인 실패",
};

export default function PartnerSettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<Settings | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [channelType, setChannelType] = useState("BLOG");
  const [channelUrl, setChannelUrl] = useState("");
  const [channelName, setChannelName] = useState("");
  const [domain, setDomain] = useState("");
  const [dnsRecord, setDnsRecord] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/partner/settings", {
      cache: "no-store",
    });
    if (response.status === 401) return router.replace("/partner/login");
    if (!response.ok) return setUnavailable(true);
    setData(await response.json());
  }
  useEffect(() => {
    load().catch(() => setUnavailable(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addChannel(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/partner/channels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey("channel"),
        },
        body: JSON.stringify({
          channel_type: channelType,
          channel_url: channelUrl,
          display_name: channelName,
        }),
      });
      if (!response.ok) throw new Error("failed");
      setChannelUrl("");
      setChannelName("");
      setMessage(
        "채널을 등록했습니다. 운영 확인 전에는 검토 중으로 표시됩니다.",
      );
      await load();
    } catch {
      setMessage("채널을 등록하지 못했습니다. https 주소를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  async function addDomain(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setDnsRecord(null);
    try {
      const response = await fetch("/api/partner/domains", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey("domain"),
        },
        body: JSON.stringify({ hostname: domain }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error("failed");
      setDomain("");
      setDnsRecord(result.verification_record);
      setMessage(
        result.verification_record
          ? "도메인을 등록했습니다. 아래 DNS 값을 지금 복사해 주세요."
          : "이미 등록된 도메인입니다. 새 확인 토큰은 발급하지 않았습니다.",
      );
      await load();
    } catch {
      setMessage(
        "도메인을 등록하지 못했습니다. 다른 파트너가 사용 중이거나 형식이 올바르지 않습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyDomain(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/partner/domains/${id}/verify`, {
        method: "POST",
      });
      if (response.status === 409) {
        setMessage("DNS 값을 아직 찾지 못했습니다. 전파 후 다시 확인해 주세요.");
      } else if (!response.ok) {
        throw new Error("failed");
      } else {
        setMessage("도메인 소유권 확인이 완료되었습니다.");
      }
      await load();
    } catch {
      setMessage("도메인 확인을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (unavailable)
    return (
      <p
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800"
      >
        설정 데이터를 불러오지 못했습니다.
      </p>
    );
  if (!data)
    return <div className="h-72 animate-pulse rounded-2xl bg-slate-200" />;
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-bold text-blue-700">설정</p>
        <h1 className="mt-1 text-3xl font-black">계정·채널·정산 준비</h1>
        <p className="mt-2 text-sm text-slate-600">
          민감한 계좌·세금 정보는 일반 입력창에 저장하지 않고 운영 검토가 가능한
          보안 절차로만 받습니다.
        </p>
      </header>
      {message ? (
        <p
          role="status"
          className="rounded-xl bg-blue-50 p-4 text-sm font-bold text-blue-900"
        >
          {message}
        </p>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard label="계정" value={data.profile.partner_status} />
        <StatusCard
          label="계좌"
          value={
            STATUS_LABEL[data.profile.payout_profile_status] ||
            data.profile.payout_profile_status
          }
        />
        <StatusCard
          label="세금 정보"
          value={
            STATUS_LABEL[data.profile.tax_profile_status] ||
            data.profile.tax_profile_status
          }
        />
        <StatusCard
          label="활성 세션"
          value={`${data.active_sessions.length}개`}
        />
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-xl font-black">필수 정책 동의</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          계약, 개인정보, 광고 표시, 지급 정책을 각각 버전과 문서 해시로
          보존합니다.
        </p>
        {data.terms.length ? (
          <ul className="mt-4 divide-y divide-slate-100">
            {data.terms.map((term) => (
              <li
                key={`${term.document_type}-${term.document_version}`}
                className="flex flex-wrap justify-between gap-2 py-3 text-sm"
              >
                <span className="font-bold">
                  {term.document_type} · {term.document_version}
                </span>
                <span className="text-slate-500">
                  {formatSettlementTimestamp(term.accepted_at, { includeYear: true })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
            운영 승인된 정책 문서 버전이 아직 등록되지 않아 동의를 임의 생성하지
            않았습니다. 문서 발행 후 온보딩에서 별도로 수락해야 합니다.
          </p>
        )}
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-xl font-black">채널</h2>
          <ul className="mt-4 space-y-2">
            {data.channels.map((channel) => (
              <li
                key={channel.id}
                className="rounded-xl bg-slate-50 p-3 text-sm"
              >
                <p className="font-bold">
                  {channel.display_name || channel.channel_type} ·{" "}
                  {STATUS_LABEL[channel.verification_status] ||
                    channel.verification_status}
                </p>
                <p className="mt-1 break-all text-slate-600">
                  {channel.channel_url}
                </p>
              </li>
            ))}
          </ul>
          <form
            onSubmit={addChannel}
            className="mt-5 space-y-3 border-t border-slate-200 pt-5"
          >
            <label className="block">
              <span className="mb-1 block text-sm font-bold">채널 유형</span>
              <select
                value={channelType}
                onChange={(event) => setChannelType(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
              >
                {[
                  "BLOG",
                  "WEBSITE",
                  "INSTAGRAM",
                  "YOUTUBE",
                  "FACEBOOK",
                  "THREADS",
                  "KAKAO",
                  "OTHER",
                ].map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">표시 이름</span>
              <input
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                maxLength={80}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
                placeholder="예: 가족여행 블로그"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold">https 주소</span>
              <input
                type="url"
                required
                value={channelUrl}
                onChange={(event) => setChannelUrl(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
                placeholder="https://example.com"
              />
            </label>
            <button
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-slate-950 px-4 font-bold text-white disabled:bg-slate-300"
            >
              채널 등록
            </button>
          </form>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-xl font-black">게시 도메인</h2>
          <p className="mt-2 text-sm text-slate-600">
            블로그·홈페이지 게시 URL은 소유권 확인된 도메인만 등록할 수
            있습니다.
          </p>
          <ul className="mt-4 space-y-2">
            {data.domains.map((row) => (
              <li key={row.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="font-bold">
                  {row.hostname} ·{" "}
                  {STATUS_LABEL[row.verification_status] ||
                    row.verification_status}
                </p>
                <p className="mt-1 text-slate-500">
                  {row.verification_method} · 마지막 점검{" "}
                  {row.last_checked_at
                    ? formatSettlementTimestamp(row.last_checked_at, { includeYear: true })
                    : "미실행"}
                </p>
                {row.verification_status !== "VERIFIED" ? (
                  <button
                    type="button"
                    onClick={() => void verifyDomain(row.id)}
                    disabled={busy}
                    className="mt-3 min-h-10 rounded-xl border border-slate-300 px-3 text-xs font-bold disabled:opacity-50"
                  >
                    DNS 확인
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <form
            onSubmit={addDomain}
            className="mt-5 space-y-3 border-t border-slate-200 pt-5"
          >
            <label className="block">
              <span className="mb-1 block text-sm font-bold">도메인</span>
              <input
                required
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
                placeholder="blog.example.com"
              />
            </label>
            <button
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-slate-950 px-4 font-bold text-white disabled:bg-slate-300"
            >
              소유권 확인 시작
            </button>
          </form>
          {dnsRecord ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-black text-amber-900">
                이 값은 한 번만 표시됩니다
              </p>
              <p className="mt-2 break-all">
                <strong>이름</strong> {dnsRecord.name}
              </p>
              <p className="mt-1 break-all">
                <strong>값</strong> {dnsRecord.value}
              </p>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard.writeText(
                    `${dnsRecord.name}\n${dnsRecord.value}`,
                  )
                }
                className="mt-3 min-h-11 rounded-xl border border-amber-400 px-4 font-bold text-amber-900"
              >
                DNS 값 복사
              </button>
            </div>
          ) : null}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h2 className="text-xl font-black">보안</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          정적 PIN은 사용하지 않습니다. 현재 로그인은 서버 세션으로 관리되며
          로그아웃, 계정 정지, 자격증명 회전 시 즉시 폐기됩니다.
        </p>
        <ul className="mt-4 divide-y divide-slate-100">
          {data.active_sessions.map((session) => (
            <li key={session.id} className="py-3 text-sm">
              <p className="font-bold">
                세션 {session.id.slice(0, 8)} · 만료{" "}
                {formatSettlementTimestamp(session.expires_at, { includeYear: true })}
              </p>
              <p className="mt-1 text-slate-500">
                마지막 사용{" "}
                {session.last_used_at
                  ? formatSettlementTimestamp(session.last_used_at, { includeYear: true })
                  : "기록 없음"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black">{value}</p>
    </article>
  );
}
