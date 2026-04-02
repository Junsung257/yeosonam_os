'use client';

import { useState } from 'react';

const CHANNEL_TYPES = [
  { value: 'blog', label: '블로그' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'cafe', label: '카페/커뮤니티' },
  { value: 'other', label: '기타' },
];

export default function PartnerApplyPage() {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    channel_type: 'blog',
    channel_url: '',
    follower_count: '',
    intro: '',
    business_type: 'individual' as 'individual' | 'business',
    business_number: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.channel_url) {
      setError('이름, 연락처, 채널 URL은 필수입니다.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/partner-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          follower_count: form.follower_count ? +form.follower_count : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '신청 실패');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">신청이 접수되었습니다!</h2>
          <p className="text-gray-500 text-sm mb-4">
            담당자가 검토 후 승인 결과를 안내드립니다.<br />
            보통 1~2일 영업일 내 처리됩니다.
          </p>
          <a href="/" className="text-blue-600 text-sm hover:underline">홈으로 돌아가기</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-lg mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* 헤더 */}
          <div className="bg-gradient-to-r from-blue-700 to-blue-900 text-white px-6 py-8">
            <h1 className="text-2xl font-bold mb-2">여소남 파트너 신청</h1>
            <p className="text-blue-200 text-sm">
              여행 콘텐츠 크리에이터로서 여소남과 함께하세요.<br />
              추천 링크를 통한 예약 시 커미션을 지급합니다.
            </p>
          </div>

          {/* 폼 */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이름 *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="홍길동" required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">연락처 *</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="010-0000-0000" required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">채널 유형 *</label>
              <select value={form.channel_type} onChange={e => setForm(f => ({ ...f, channel_type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                {CHANNEL_TYPES.map(ct => (
                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">채널 URL *</label>
              <input type="url" value={form.channel_url} onChange={e => setForm(f => ({ ...f, channel_url: e.target.value }))}
                placeholder="https://blog.naver.com/example" required
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">팔로워/구독자 수</label>
              <input type="number" value={form.follower_count} onChange={e => setForm(f => ({ ...f, follower_count: e.target.value }))}
                placeholder="예: 5000"
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">자기소개</label>
              <textarea value={form.intro} onChange={e => setForm(f => ({ ...f, intro: e.target.value }))}
                rows={3} placeholder="어떤 여행 콘텐츠를 만드시나요?"
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사업자 유형</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="btype" value="individual"
                    checked={form.business_type === 'individual'}
                    onChange={() => setForm(f => ({ ...f, business_type: 'individual' }))} />
                  <span className="text-sm">개인 (원천세 3.3%)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="btype" value="business"
                    checked={form.business_type === 'business'}
                    onChange={() => setForm(f => ({ ...f, business_type: 'business' }))} />
                  <span className="text-sm">사업자</span>
                </label>
              </div>
            </div>

            {form.business_type === 'business' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사업자번호</label>
                <input type="text" value={form.business_number} onChange={e => setForm(f => ({ ...f, business_number: e.target.value }))}
                  placeholder="000-00-00000"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {submitting ? '제출 중...' : '파트너 신청하기'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              신청 후 담당자 검토를 거쳐 파트너 포털 접속 정보가 안내됩니다.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
