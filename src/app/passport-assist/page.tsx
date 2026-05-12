'use client';

/**
 * Phase 3-G: 여권 OCR 자동완성 페이지
 * /passport-assist
 *
 * - 여권 사진 업로드 → OCR API 호출 → 폼 자동 채움
 * - 고객이 검토 후 복사 or 인쇄
 */

import { useState, useRef } from 'react';

interface PassportData {
  surname: string | null;
  given_name: string | null;
  passport_no: string | null;
  nationality: string | null;
  birth_date: string | null;
  expiry_date: string | null;
  gender: string | null;
  mrz_line1: string | null;
  mrz_line2: string | null;
}

const EMPTY_DATA: PassportData = {
  surname: '',
  given_name: '',
  passport_no: '',
  nationality: '',
  birth_date: '',
  expiry_date: '',
  gender: '',
  mrz_line1: '',
  mrz_line2: '',
};

const FIELD_LABELS: Record<keyof PassportData, string> = {
  surname: '성 (Surname)',
  given_name: '이름 (Given Name)',
  passport_no: '여권 번호',
  nationality: '국적 코드',
  birth_date: '생년월일 (YYYY-MM-DD)',
  expiry_date: '만료일 (YYYY-MM-DD)',
  gender: '성별 (M/F)',
  mrz_line1: 'MRZ 1행',
  mrz_line2: 'MRZ 2행',
};

export default function PassportAssistPage() {
  const [formData, setFormData] = useState<PassportData>(EMPTY_DATA);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setError(null);
    setSuccess(false);
  };

  const handleOcr = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('여권 이미지를 먼저 선택하세요.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/passport/ocr', {
        method: 'POST',
        body: fd,
      });

      const json = await res.json() as { ok?: boolean; data?: PassportData; error?: string };

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'OCR 실패');
      }

      const d: PassportData = json.data ?? {
        surname: null, given_name: null, passport_no: null, nationality: null,
        birth_date: null, expiry_date: null, gender: null, mrz_line1: null, mrz_line2: null,
      };
      setFormData({
        surname: d.surname ?? '',
        given_name: d.given_name ?? '',
        passport_no: d.passport_no ?? '',
        nationality: d.nationality ?? '',
        birth_date: d.birth_date ?? '',
        expiry_date: d.expiry_date ?? '',
        gender: d.gender ?? '',
        mrz_line1: d.mrz_line1 ?? '',
        mrz_line2: d.mrz_line2 ?? '',
      });
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (key: keyof PassportData, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setFormData(EMPTY_DATA);
    setPreview(null);
    setError(null);
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCopy = async () => {
    const lines = (Object.keys(FIELD_LABELS) as (keyof PassportData)[]).map(
      key => `${FIELD_LABELS[key]}: ${formData[key] || '—'}`,
    );
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 헤더 */}
        <div>
          <h1 className="text-[22px] font-bold text-slate-800">여권 정보 자동입력</h1>
          <p className="text-[13px] text-slate-500 mt-1">
            여권 사진을 업로드하면 AI가 정보를 자동으로 인식합니다.
          </p>
        </div>

        {/* 안내 배너 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[12px] text-blue-700">
          개인정보는 이 기기에서만 처리됩니다. 여권 이미지는 서버에 저장되지 않습니다.
        </div>

        {/* 업로드 영역 */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-[14px] font-semibold text-slate-700">1단계: 여권 사진 업로드</h2>
          <div
            className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="여권 미리보기"
                className="max-h-48 mx-auto rounded-md object-contain"
              />
            ) : (
              <div className="space-y-2">
                <div className="text-4xl text-slate-300">📷</div>
                <p className="text-[13px] text-slate-500">클릭하여 여권 이미지 선택</p>
                <p className="text-[11px] text-slate-400">JPEG · PNG · WEBP · HEIC (최대 10MB)</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[12px] text-red-600">
              {error}
            </div>
          )}

          <button
            onClick={() => void handleOcr()}
            disabled={loading || !preview}
            className="w-full py-2.5 bg-indigo-600 text-white text-[14px] font-semibold rounded-lg hover:bg-indigo-700 transition disabled:opacity-40"
          >
            {loading ? 'AI 인식 중…' : '자동 인식 시작'}
          </button>
        </div>

        {/* 결과 폼 */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-slate-700">2단계: 정보 확인 및 수정</h2>
            {success && (
              <span className="text-[12px] text-emerald-600 font-medium">AI 인식 완료</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(FIELD_LABELS) as (keyof PassportData)[]).map(key => (
              <div key={key} className={key === 'mrz_line1' || key === 'mrz_line2' ? 'col-span-2' : ''}>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {FIELD_LABELS[key]}
                </label>
                <input
                  type="text"
                  value={formData[key] ?? ''}
                  onChange={e => handleFieldChange(key, e.target.value)}
                  className={`w-full border rounded px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                    key === 'mrz_line1' || key === 'mrz_line2'
                      ? 'font-mono text-[12px] border-slate-300'
                      : 'border-slate-300'
                  }`}
                  placeholder={success ? '' : '자동 인식 후 채워집니다'}
                />
              </div>
            ))}
          </div>

          {/* 액션 버튼 */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => void handleCopy()}
              disabled={!success}
              className="flex-1 py-2 bg-slate-800 text-white text-[13px] rounded-lg hover:bg-slate-900 transition disabled:opacity-40"
            >
              {copied ? '복사됨!' : '텍스트 복사'}
            </button>
            <button
              onClick={handlePrint}
              disabled={!success}
              className="flex-1 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] rounded-lg hover:bg-slate-50 transition disabled:opacity-40"
            >
              인쇄
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-slate-500 text-[13px] rounded-lg hover:bg-slate-100 transition"
            >
              초기화
            </button>
          </div>
        </div>

        {/* 안내사항 */}
        <div className="text-[11px] text-slate-400 space-y-1">
          <p>• 여권 정면(사진·MRZ 포함)이 선명하게 찍힌 이미지를 사용하세요.</p>
          <p>• AI 인식 결과를 반드시 직접 확인하세요. 오인식이 있을 수 있습니다.</p>
          <p>• 여권 만료일이 출발일로부터 6개월 이상 남아있어야 합니다.</p>
        </div>
      </div>
    </div>
  );
}
