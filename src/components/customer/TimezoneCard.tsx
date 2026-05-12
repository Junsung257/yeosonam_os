/**
 * 시차 카드 — 한국(KST) ↔ 현지 라이브 시각 비교 + 실용 팁
 *
 * 1초마다 업데이트. utc_offset_minutes 는 destination_climate에서 좌표 기반으로 계산된 값
 * (DST 도시는 빌드 시점 ±60분 변동 가능 — 일본·중국·동남아는 DST 없음).
 *
 * 실용 팁 (사장님 피드백 2026-04-29 반영):
 *  - 시차 0~1시간: 시차 적응 거의 없음
 *  - 2~3시간: 도착 후 일정 여유 / 귀국 시 약간 적응 필요
 *  - 4시간+: 여행 일정 시차 적응 권장
 */
'use client';

import { useState, useEffect } from 'react';

interface Props {
  destination: string;
  primaryCity: string;
  country: string | null;
  /** KST(+540min) 대비 분 단위 차이. 음수 = 한국보다 늦음 */
  offsetMinutes: number;
  timezone: string; // IANA TZ — 라이브 표시용
}

function fmtTimeInTz(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(now);
  } catch { return '—'; }
}

function fmtDateInTz(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: timezone, month: 'numeric', day: 'numeric', weekday: 'short',
    }).format(now);
  } catch { return ''; }
}

/** 시차 폭에 따른 실용 팁 자동 생성 */
function timezoneTips(offsetMinutes: number): string[] {
  const absH = Math.abs(offsetMinutes) / 60;
  const direction = offsetMinutes > 0 ? '빠름' : offsetMinutes < 0 ? '느림' : '없음';

  if (offsetMinutes === 0) {
    return [
      '한국과 시차 없음 — 도착 즉시 바로 일정 가능',
      '귀국 시에도 시차 적응 0',
    ];
  }
  if (absH <= 1) {
    return [
      '시차 적응 거의 없음 👍',
      '도착 당일 저녁부터 꽉 찬 일정 가능',
      '귀국 후 다음날 바로 업무 복귀 — 연차 아껴도 충분',
    ];
  }
  if (absH <= 3) {
    if (direction === '느림') {
      return [
        `한국보다 ${absH}시간 ${direction} — 도착 후 일정 여유`,
        '오후 출발 시 현지에서 저녁 일정까지 가능',
        '귀국 시 약간의 적응 필요 (1-2일)',
      ];
    }
    return [
      `한국보다 ${absH}시간 ${direction}`,
      '도착 시간 = 한국 기준 +몇 시간 → 일정 계획 시 고려',
      '귀국 후 시차 적응 1-2일',
    ];
  }
  // 4시간+
  return [
    `한국보다 ${absH}시간 ${direction} — 시차 큰 편`,
    '여행 첫날은 가벼운 일정 권장',
    '귀국 후 2-3일 시차 적응 시간 필요',
  ];
}

export default function TimezoneCard({ destination, primaryCity, country, offsetMinutes, timezone }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const offsetH = Math.abs(offsetMinutes) / 60;
  const offsetText = offsetMinutes === 0
    ? '한국과 시차 없음'
    : offsetMinutes > 0
      ? `한국보다 ${offsetH % 1 === 0 ? offsetH : offsetH.toFixed(1)}시간 빠름`
      : `한국보다 ${offsetH % 1 === 0 ? offsetH : offsetH.toFixed(1)}시간 느림`;

  const seoulFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const seoulTime = seoulFmt.format(now);
  const localTime = fmtTimeInTz(now, timezone);
  const localDate = fmtDateInTz(now, timezone);
  const displayCity = primaryCity || destination;
  const tips = timezoneTips(offsetMinutes);

  return (
    <section className="px-4 mt-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-extrabold text-slate-900">⏰ 시차 안내</h3>
          <span className="text-[11px] text-slate-500 font-semibold">{offsetText}</span>
        </div>

        {/* 라이브 시각 비교 */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-base">🇰🇷</span>
              <span className="text-xs text-slate-500 font-medium">서울 (KST)</span>
            </div>
            <div className="text-lg font-extrabold text-slate-900 tabular-nums">{seoulTime}</div>
          </div>
          <div className="bg-violet-50 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-base">📍</span>
              <span className="text-xs text-violet-700 font-medium">{displayCity}</span>
            </div>
            <div className="text-xl font-extrabold text-violet-900 tabular-nums">{localTime}</div>
            {localDate && <div className="text-[10px] text-violet-600 mt-0.5">{localDate}</div>}
          </div>
        </div>

        {/* 실용 팁 */}
        <div className="bg-gradient-to-br from-[#F5F0FF]/60 to-brand-light/40 border border-[#E9D5FF]/60 rounded-xl p-3.5">
          <p className="text-micro font-bold text-violet-700 mb-2">💡 여행 팁</p>
          <ul className="space-y-1.5">
            {tips.map((t, i) => (
              <li key={i} className="text-[13px] text-slate-700 leading-snug flex gap-1.5 break-keep">
                <span className="text-violet-400 flex-shrink-0">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
