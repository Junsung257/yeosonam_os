interface Props {
  publishedAt: string;
  updatedAt?: string | null;
  destination?: string;
}

export default function AuthorBox({ publishedAt, updatedAt, destination }: Props) {
  const pub = new Date(publishedAt);
  const upd = updatedAt ? new Date(updatedAt) : null;
  const hasUpdate =
    upd &&
    pub &&
    Math.abs(upd.getTime() - pub.getTime()) > 1000 * 60 * 60 * 24; // 1일 이상 차이

  const fmt = (d: Date) =>
    d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <section
      className="not-prose my-12 rounded-2xl border border-slate-100 bg-slate-50/70 p-5 md:p-6"
      aria-label="작성자 정보"
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-lg font-bold text-white shadow-sm"
          aria-hidden="true"
        >
          여
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold text-slate-900">여소남 에디터</p>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              운영팀 검증
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            여소남 상품 운영팀(OP)이 랜드사와 직접 확인한
            {destination ? ` ${destination} ` : ' '}
            여행 일정·가격·포함 항목을 기준으로 작성되었습니다. 현지 사정에 따라 변경될 수
            있으며, 예약 시점 조건이 최종 기준입니다.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            <span>발행 {fmt(pub)}</span>
            {hasUpdate && upd && (
              <>
                <span className="mx-1.5">·</span>
                <span className="font-medium text-emerald-600">
                  최종 업데이트 {fmt(upd)}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
