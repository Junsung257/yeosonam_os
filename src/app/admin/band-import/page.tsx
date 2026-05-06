'use client';

import { useState, useEffect, useCallback } from 'react';

interface Preview {
  internal_code: string;
  display_name: string;
  destination: string;
  destination_code: string;
  departure_region: string;
  departure_region_code: string;
  duration_days: number;
  departure_date: string | null;
  net_price: number | null;
  ai_tags: string[];
  source: string;
  band_post_url: string | null;
}

interface ImportLog {
  id: string;
  post_url: string;
  post_title: string | null;
  status: string;
  imported_at: string;
  product_id: string | null;
}

export default function BandImportPage() {
  const [rawText, setRawText] = useState('');
  const [bandPostUrl, setBandPostUrl] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [logs, setLogs] = useState<ImportLog[]>([]);

  const fetchLogs = useCallback(async () => {
    const res = await fetch('/api/band-import/logs');
    if (res.ok) {
      const { logs } = await res.json() as { logs: ImportLog[] };
      setLogs(logs);
    }
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  async function handleAnalyze() {
    if (!rawText.trim()) return;
    setAnalyzing(true);
    setPreview(null);
    setMessage(null);
    try {
      const res = await fetch('/api/products/scan-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, bandPostUrl: bandPostUrl.trim() || undefined }),
      });
      const json = await res.json() as { preview?: Preview; error?: string; existing?: { status: string } };
      if (!res.ok) {
        if (res.status === 409) {
          setMessage({ type: 'err', text: `이미 임포트된 게시글입니다 (상태: ${json.existing?.status})` });
        } else {
          setMessage({ type: 'err', text: json.error ?? '분석 실패' });
        }
      } else {
        setPreview(json.preview!);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    if (!preview) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/band-import/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview, rawText }),
      });
      const json = await res.json() as { productId?: string; error?: string };
      if (!res.ok) {
        setMessage({ type: 'err', text: json.error ?? '저장 실패' });
      } else {
        setMessage({ type: 'ok', text: `✅ 상품 등록 완료 (ID: ${json.productId})` });
        setRawText('');
        setBandPostUrl('');
        setPreview(null);
        fetchLogs();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">밴드 게시글 임포트</h1>
        <p className="text-sm text-slate-500 mt-1">밴드 게시글을 붙여넣으면 AI가 상품 정보를 자동 추출합니다</p>
      </div>

      {/* 입력 영역 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            밴드 게시글 URL <span className="text-slate-400">(선택 — 중복 방지용)</span>
          </label>
          <input
            type="url"
            value={bandPostUrl}
            onChange={e => setBandPostUrl(e.target.value)}
            placeholder="https://band.us/band/.../post/..."
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            게시글 내용 붙여넣기 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            rows={10}
            placeholder="밴드 게시글 전체 텍스트를 여기에 붙여넣으세요&#10;(상품명, 여행지, 가격, 일정, 포함사항 등이 포함된 내용)"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
          <p className="text-xs text-slate-400 mt-1">{rawText.length.toLocaleString()}자</p>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={analyzing || !rawText.trim()}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {analyzing ? '🔍 AI 분석 중...' : '🤖 AI 분석'}
        </button>
      </div>

      {/* 알림 */}
      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          message.type === 'ok'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* AI 추출 미리보기 */}
      {preview && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">AI 추출 결과</h2>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="상품코드 (예정)" value={preview.internal_code} />
            <Field label="상품명" value={preview.display_name} />
            <Field label="여행지" value={`${preview.destination} (${preview.destination_code})`} />
            <Field label="출발지" value={`${preview.departure_region} (${preview.departure_region_code})`} />
            <Field label="여행 일수" value={`${preview.duration_days}일`} />
            <Field label="출발일" value={preview.departure_date ?? '미확인'} />
            <Field label="가격" value={preview.net_price ? `${preview.net_price.toLocaleString()}원` : '미확인'} />
            <Field label="소스" value={preview.source} />
          </div>

          {preview.ai_tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {preview.ai_tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition"
            >
              {saving ? '저장 중...' : '✅ 상품 등록'}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="px-4 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 임포트 이력 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5">
        <h2 className="text-base font-semibold text-slate-800 mb-3">임포트 이력</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-400">아직 임포트 이력이 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-4 font-medium text-slate-500">게시글</th>
                  <th className="text-left py-2 pr-4 font-medium text-slate-500">상태</th>
                  <th className="text-left py-2 font-medium text-slate-500">임포트 일시</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 pr-4 max-w-xs truncate">
                      {log.post_url ? (
                        <a href={log.post_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          {log.post_title || log.post_url}
                        </a>
                      ) : (
                        <span className="text-slate-500">텍스트 붙여넣기</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="py-2 text-slate-500">
                      {new Date(log.imported_at).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium text-slate-900">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    imported: 'bg-green-50 text-green-700',
    pending:  'bg-yellow-50 text-yellow-700',
    skipped:  'bg-slate-100 text-slate-500',
    failed:   'bg-red-50 text-red-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}
