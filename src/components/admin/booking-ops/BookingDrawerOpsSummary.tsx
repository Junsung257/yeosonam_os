'use client';

interface BookingDrawerOpsSummaryBooking {
  booking_no?: string;
  package_title?: string;
  adult_count: number;
  child_count: number;
  infant_count?: number;
  total_price?: number;
  paid_amount?: number;
  total_paid_out?: number;
  departure_date?: string;
  return_date?: string;
  departure_region?: string;
  land_operator?: string;
  manager_name?: string;
  customers?: { name: string; phone?: string };
}

interface BookingDrawerOpsSummaryProps {
  booking: BookingDrawerOpsSummaryBooking;
  totalSale: number;
  effectiveNet: number;
  actualIncome: number;
  actualExpense: number;
}

const won = (value: number) => `₩${Math.round(value).toLocaleString('ko-KR')}`;

function formatDate(value?: string) {
  if (!value) return '-';
  return value.slice(0, 10);
}

function daysUntil(value?: string) {
  if (!value) return null;
  const departure = new Date(`${value.slice(0, 10)}T00:00:00+09:00`).getTime();
  if (Number.isNaN(departure)) return null;
  const today = new Date();
  const seoulToday = new Date(
    today.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }),
  );
  seoulToday.setHours(0, 0, 0, 0);
  return Math.ceil((departure - seoulToday.getTime()) / 86_400_000);
}

function statusTone(value: number, warningAt = 0) {
  if (value <= warningAt) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-amber-200 bg-amber-50 text-amber-900';
}

export function BookingDrawerOpsSummary({
  booking,
  totalSale,
  effectiveNet,
  actualIncome,
  actualExpense,
}: BookingDrawerOpsSummaryProps) {
  const customerUnpaid = Math.max(0, totalSale - actualIncome);
  const supplierUnpaid = Math.max(0, effectiveNet - actualExpense);
  const margin = totalSale - effectiveNet;
  const marginRate = totalSale > 0 ? (margin / totalSale) * 100 : 0;
  const passengerCount =
    (booking.adult_count || 0) + (booking.child_count || 0) + (booking.infant_count || 0);
  const dday = daysUntil(booking.departure_date);

  const travelTone =
    dday === null
      ? 'border-slate-200 bg-slate-50 text-slate-700'
      : dday < 0
        ? 'border-slate-200 bg-slate-50 text-slate-600'
        : dday <= 3
          ? 'border-rose-200 bg-rose-50 text-rose-800'
          : dday <= 7
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-blue-100 bg-blue-50 text-blue-800';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase text-slate-400">운영 요약</p>
          <h3 className="mt-1 truncate text-[14px] font-extrabold text-slate-950">
            {booking.customers?.name || '고객 미지정'}
          </h3>
        </div>
        <div className={`shrink-0 rounded-md border px-2 py-1 text-right text-[11px] font-bold ${travelTone}`}>
          {dday === null ? '일정 없음' : dday < 0 ? '출발 완료' : dday === 0 ? '오늘 출발' : `D-${dday}`}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="고객 잔금" value={won(customerUnpaid)} tone={statusTone(customerUnpaid)} />
        <Metric label="랜드 미송금" value={won(supplierUnpaid)} tone={statusTone(supplierUnpaid)} />
        <Metric
          label="예상 마진"
          value={won(margin)}
          hint={totalSale > 0 ? `${marginRate.toFixed(1)}%` : undefined}
          tone={
            marginRate < 8
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }
        />
        <Metric
          label="인원"
          value={`${passengerCount}명`}
          hint={`성인 ${booking.adult_count || 0} · 아동 ${booking.child_count || 0}`}
          tone="border-slate-200 bg-slate-50 text-slate-800"
        />
      </div>

      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-[12px]">
        <SummaryLine label="여행" value={`${formatDate(booking.departure_date)} ~ ${formatDate(booking.return_date)}`} />
        <SummaryLine label="상품" value={booking.package_title || '-'} />
        <SummaryLine label="랜드" value={booking.land_operator || '-'} />
        <SummaryLine label="담당" value={booking.manager_name || '-'} />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className={`min-w-0 rounded-md border px-2.5 py-2 ${tone}`}>
      <p className="text-[10px] font-bold opacity-70">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[10px] font-semibold opacity-70">{hint}</p>}
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-8 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{value}</span>
    </div>
  );
}
