'use client';

import { useState } from 'react';

interface Props {
  bookingId: string;
}

const DETAIL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'value_for_money', label: '가성비' },
  { key: 'itinerary_quality', label: '일정' },
  { key: 'guide_quality', label: '가이드' },
  { key: 'accommodation_quality', label: '숙소' },
  { key: 'food_quality', label: '식사' },
  { key: 'transportation_quality', label: '교통' },
];

function StarInput({ value, onChange, size = 'lg' }: { value: number; onChange: (n: number) => void; size?: 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'text-3xl' : 'text-[18px]';
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`${cls} transition hover:scale-110 ${n <= value ? 'text-amber-400' : 'text-slate-300'}`}
          aria-label={`${n}점`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function ReviewForm({ bookingId }: Props) {
  const [overall, setOverall] = useState(0);
  const [details, setDetails] = useState<Record<string, number>>({});
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [prosText, setProsText] = useState('');
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (overall === 0) { setError('전체 평점은 필수예요 ⭐'); return; }
    if (!body.trim() || body.trim().length < 10) { setError('후기는 10자 이상 작성해주세요.'); return; }

    setSubmitting(true);
    try {
      const pros = prosText.split(',').map(s => s.trim()).filter(Boolean);
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          overall_rating: overall,
          ...details,
          title: title.trim() || null,
          review_text: body.trim(),
          pros: pros.length > 0 ? pros : null,
          would_recommend: recommend,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '제출 실패');
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mt-6 p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
        <div className="text-4xl mb-2">🙏</div>
        <h2 className="text-[18px] font-bold text-emerald-800">소중한 후기 감사합니다</h2>
        <p className="mt-1 text-[13px] text-emerald-700">
          운영팀 검토 후 다른 여행자분들께 공유됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      {/* 전체 평점 */}
      <section className="p-5 bg-white border border-slate-200 rounded-xl">
        <label className="block text-[13px] font-semibold text-slate-700 mb-3">
          전체 만족도 <span className="text-rose-500">*</span>
        </label>
        <StarInput value={overall} onChange={setOverall} />
        {overall > 0 && (
          <p className="mt-2 text-[12px] text-slate-500">
            {overall === 5 && '최고예요! 감사합니다 ✨'}
            {overall === 4 && '만족하셨군요, 감사합니다 😊'}
            {overall === 3 && '보통이셨네요. 솔직한 피드백 부탁드려요.'}
            {overall === 2 && '아쉬운 점을 알려주세요. 개선하겠습니다.'}
            {overall === 1 && '불편하셨다니 죄송합니다. 상세히 알려주세요.'}
          </p>
        )}
      </section>

      {/* 세부 평가 */}
      <section className="p-5 bg-white border border-slate-200 rounded-xl">
        <h3 className="text-[13px] font-semibold text-slate-700 mb-3">세부 평가 (선택)</h3>
        <div className="grid grid-cols-2 gap-3">
          {DETAIL_FIELDS.map(f => (
            <div key={f.key} className="flex items-center justify-between">
              <span className="text-[12px] text-slate-600">{f.label}</span>
              <StarInput
                size="md"
                value={details[f.key] || 0}
                onChange={n => setDetails({ ...details, [f.key]: n })}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 후기 내용 */}
      <section className="p-5 bg-white border border-slate-200 rounded-xl space-y-3">
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            후기 제목 (선택)
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={50}
            placeholder="한 줄로 표현한다면?"
            className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            자세한 후기 <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="여행에서 좋았던 점, 아쉬웠던 점, 다른 분들께 도움될 팁 등을 자유롭게 적어주세요."
            className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 resize-none"
          />
          <p className="mt-1 text-[11px] text-slate-400">{body.length}/2,000자</p>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            좋았던 점 키워드 (쉼표로 구분)
          </label>
          <input
            value={prosText}
            onChange={e => setProsText(e.target.value)}
            placeholder="예: 노팁, 친절한 가이드, 깨끗한 호텔"
            className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
          />
        </div>
      </section>

      {/* 추천 여부 */}
      <section className="p-5 bg-white border border-slate-200 rounded-xl">
        <label className="block text-[13px] font-semibold text-slate-700 mb-3">
          지인에게 추천하시겠어요?
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRecommend(true)}
            className={`flex-1 py-2.5 rounded-lg border transition text-[13px] font-semibold ${
              recommend === true ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            👍 추천합니다
          </button>
          <button
            type="button"
            onClick={() => setRecommend(false)}
            className={`flex-1 py-2.5 rounded-lg border transition text-[13px] font-semibold ${
              recommend === false ? 'bg-slate-100 border-slate-400 text-slate-700' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            🤔 아니요
          </button>
        </div>
      </section>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-[13px]">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold text-[15px] hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? '제출 중...' : '후기 제출하기'}
      </button>
    </div>
  );
}
