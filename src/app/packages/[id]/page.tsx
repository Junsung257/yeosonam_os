'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

const COMMISSION_RATE = 9;
function applyCommission(price: number) {
  return Math.round(price * (1 + COMMISSION_RATE / 100));
}

interface Package {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  confidence?: number;
  file_type?: string;
  raw_text?: string;
  itinerary?: string[];
  inclusions?: string[];
  excludes?: string[];
  accommodations?: string[];
  special_notes?: string;
  filename?: string;
  created_at?: string;
}

type TabKey = '개요' | '일정' | '포함/불포함' | '전체 텍스트';

export default function PackageDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const [pkg, setPkg] = useState<Package | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('개요');

  // 어필리에이트 추천 링크 캡처 (?ref=CODE&sub=YOUTUBE)
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) {
      const sub = searchParams.get('sub') || '';
      fetch(`/api/influencer/track?ref=${ref}&pkg=${id}${sub ? `&sub=${sub}` : ''}`)
        .catch(() => {}); // 추적 실패해도 무시
    }
  }, [id, searchParams]);

  useEffect(() => {
    fetch(`/api/packages?id=${id}`)
      .then(r => r.json())
      .then(data => setPkg(data.package ?? null))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  if (!pkg) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-500">
        <p className="text-lg mb-4">상품을 찾을 수 없습니다.</p>
        <Link href="/packages" className="text-blue-600 underline">목록으로 돌아가기</Link>
      </div>
    );
  }

  const tabs: TabKey[] = ['개요', '일정', '포함/불포함', '전체 텍스트'];

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* 헤더 */}
        <div className="mb-4">
          <Link href="/packages" className="text-sm text-blue-600 hover:underline">← 목록으로</Link>
        </div>

        <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-8 lg:items-start">
          {/* 왼쪽: 메인 */}
          <div>
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl p-6 mb-6">
              <h1 className="text-2xl font-bold mb-3">{pkg.title}</h1>
              <div className="flex flex-wrap gap-4 text-sm">
                {pkg.destination && <span>📍 {pkg.destination}</span>}
                {pkg.duration && <span>🗓 {pkg.duration}일</span>}
                {pkg.confidence !== undefined && (
                  <span className={`px-2 py-0.5 rounded-full ${
                    pkg.confidence >= 0.8 ? 'bg-green-400/80' :
                    pkg.confidence >= 0.6 ? 'bg-yellow-400/80' : 'bg-red-400/80'
                  }`}>신뢰도 {Math.round(pkg.confidence * 100)}%</span>
                )}
              </div>
              {pkg.price && (
                <div className="mt-4 pt-4 border-t border-white/20">
                  <p className="text-white/70 text-sm">기본가 {pkg.price.toLocaleString()}원</p>
                  <p className="text-3xl font-bold">
                    {applyCommission(pkg.price).toLocaleString()}원
                    <span className="text-base font-normal text-white/70 ml-2">/ 1인 (커미션 {COMMISSION_RATE}% 포함)</span>
                  </p>
                </div>
              )}
            </div>

            {/* 탭 */}
            <div className="flex border-b border-gray-200 mb-6">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-3 text-sm font-medium transition border-b-2 -mb-px ${
                    activeTab === tab
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* 탭 내용 */}
            <div className="bg-white rounded-xl shadow p-6">
          {activeTab === '개요' && (
            <div className="space-y-4 text-sm text-gray-700">
              {pkg.filename && <div><span className="font-medium text-gray-900">원본 파일:</span> {pkg.filename}</div>}
              {pkg.file_type && <div><span className="font-medium text-gray-900">파일 타입:</span> {pkg.file_type.toUpperCase()}</div>}
              {pkg.special_notes && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="font-medium text-yellow-800 mb-1">특별 안내</p>
                  <p className="text-yellow-700">{pkg.special_notes}</p>
                </div>
              )}
              {pkg.accommodations && pkg.accommodations.length > 0 && (
                <div>
                  <p className="font-medium text-gray-900 mb-2">숙박</p>
                  <ul className="space-y-1">{pkg.accommodations.map((a, i) => <li key={i}>🏨 {a}</li>)}</ul>
                </div>
              )}
              {!pkg.special_notes && !pkg.accommodations?.length && (
                <p className="text-gray-400 text-center py-8">추가 정보가 없습니다. "전체 텍스트" 탭을 확인하세요.</p>
              )}
            </div>
          )}

          {activeTab === '일정' && (
            <div>
              {pkg.itinerary && pkg.itinerary.length > 0 ? (
                <ol className="space-y-3">
                  {pkg.itinerary.map((item, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                      <p className="text-gray-700 text-sm pt-1">{item}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-gray-400 text-center py-8">일정 정보가 없습니다. "전체 텍스트" 탭을 확인하세요.</p>
              )}
            </div>
          )}

          {activeTab === '포함/불포함' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="text-green-600">✓</span> 포함
                </h3>
                {pkg.inclusions && pkg.inclusions.length > 0 ? (
                  <ul className="space-y-2">
                    {pkg.inclusions.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-green-500 mt-0.5">✓</span> {item}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-gray-400 text-sm">정보 없음</p>}
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="text-red-500">✗</span> 불포함
                </h3>
                {pkg.excludes && pkg.excludes.length > 0 ? (
                  <ul className="space-y-2">
                    {pkg.excludes.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-red-400 mt-0.5">✗</span> {item}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-gray-400 text-sm">정보 없음</p>}
              </div>
            </div>
          )}

          {activeTab === '전체 텍스트' && (
            <div>
              {pkg.raw_text ? (
                <>
                  <p className="text-xs text-gray-400 mb-3">{pkg.raw_text.length.toLocaleString()}자 추출됨</p>
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed bg-gray-50 p-4 rounded-lg max-h-[600px] overflow-y-auto border border-gray-200">
                    {pkg.raw_text}
                  </pre>
                </>
              ) : (
                <p className="text-gray-400 text-center py-8">추출된 텍스트가 없습니다.</p>
              )}
            </div>
          )}
            </div>

            {/* AI 상담 CTA (모바일) */}
            <div className="mt-6 lg:hidden bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-blue-900">이 상품이 궁금하신가요?</p>
                <p className="text-sm text-blue-700">AI 상담원이 즉시 답변해드립니다</p>
              </div>
              <Link href="/admin/qa" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
                AI 상담 시작
              </Link>
            </div>
          </div>

          {/* 오른쪽: 사이드바 (PC) */}
          <div className="hidden lg:block lg:sticky lg:top-8 space-y-4">
            {pkg.price && (
              <div className="bg-white rounded-xl shadow p-5">
                <p className="text-xs text-gray-400 mb-1">1인 기준 판매가</p>
                <p className="text-3xl font-bold text-indigo-700">{applyCommission(pkg.price).toLocaleString()}원</p>
                <p className="text-xs text-gray-400 mt-0.5">기본가 {pkg.price.toLocaleString()}원 + 커미션 {COMMISSION_RATE}%</p>
                <Link
                  href="/admin/qa"
                  className="mt-4 block text-center bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition"
                >
                  AI 상담 시작
                </Link>
              </div>
            )}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-900 mb-1">📋 빠른 정보</p>
              <ul className="space-y-1 text-xs text-blue-700">
                {pkg.destination && <li>📍 목적지: {pkg.destination}</li>}
                {pkg.duration && <li>🗓 기간: {pkg.duration}일</li>}
                {pkg.filename && <li>📄 파일: {pkg.filename}</li>}
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
