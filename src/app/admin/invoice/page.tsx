'use client';

import { useRef, useState } from 'react';
import { fmtDateISO } from '@/lib/admin-utils';

interface InvoiceItem {
  description: string;
  amount: number;
}

interface ParsedInvoice {
  vendor: string;
  invoice_date: string | null;
  currency: string;
  amount_krw: number | null;
  amount_usd: number | null;
  items: InvoiceItem[];
  total: number | null;
}

interface Discrepancy {
  type: string;
  description: string;
  invoice_amount: number | null;
  ledger_amount: number | null;
}

interface LedgerEntry {
  created_at: string | null;
  account: string | null;
  entry_type: string | null;
  amount: number | null;
  memo: string | null;
}

interface ParseResult {
  parsed: ParsedInvoice;
  ledger_entries: LedgerEntry[];
  discrepancies: Discrepancy[];
}

export default function InvoiceParsePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landOperatorId, setLandOperatorId] = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setResult(null);
    setError(null);

    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  }

  async function handleParse() {
    if (!selectedFile) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (landOperatorId.trim()) {
        formData.append('land_operator_id', landOperatorId.trim());
      }

      const res = await fetch('/api/admin/invoice/parse', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '파싱 실패');
        return;
      }

      setResult(data as ParseResult);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function formatAmount(amount: number | null, currency = 'KRW') {
    if (amount === null) return '-';
    if (currency === 'USD') return `$${amount.toLocaleString()}`;
    return `${amount.toLocaleString()}원`;
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>인보이스 자동 파싱</h1>
      <p style={styles.pageDesc}>
        랜드사 청구서 이미지를 업로드하면 AI가 금액·항목을 추출하고 원장과 대조합니다.
      </p>

      {/* 업로드 영역 */}
      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>파일 업로드</h2>

        <div
          style={styles.dropzone}
          onClick={() => fileInputRef.current?.click()}
        >
          {preview ? (
            <img src={preview} alt="미리보기" style={styles.previewImg} />
          ) : (
            <div style={styles.dropzonePlaceholder}>
              <div style={styles.uploadIcon}>📄</div>
              <p style={styles.dropzoneText}>클릭하여 인보이스 이미지 선택</p>
              <p style={styles.dropzoneHint}>JPG, PNG, WEBP 지원</p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {selectedFile && (
          <p style={styles.fileName}>{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</p>
        )}

        <div style={styles.optionRow}>
          <label style={styles.label}>랜드사 ID (선택)</label>
          <input
            type="text"
            placeholder="UUID 입력 시 해당 랜드사 원장과 대조"
            value={landOperatorId}
            onChange={e => setLandOperatorId(e.target.value)}
            style={styles.input}
          />
        </div>

        <button
          onClick={handleParse}
          disabled={!selectedFile || loading}
          style={selectedFile && !loading ? styles.btnActive : styles.btnDisabled}
        >
          {loading ? 'AI 파싱 중...' : '인보이스 파싱'}
        </button>

        {error && <p style={styles.errorText}>{error}</p>}
      </div>

      {/* 파싱 결과 */}
      {result && (
        <>
          {/* 기본 정보 */}
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>파싱 결과</h2>
            <div style={styles.infoGrid}>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>공급업체</span>
                <span style={styles.infoValue}>{result.parsed.vendor || '-'}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>청구일</span>
                <span style={styles.infoValue}>{result.parsed.invoice_date || '-'}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>통화</span>
                <span style={styles.infoValue}>{result.parsed.currency || '-'}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>원화 금액</span>
                <span style={{ ...styles.infoValue, fontWeight: 700, color: '#111827' }}>
                  {formatAmount(result.parsed.amount_krw, 'KRW')}
                </span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>달러 금액</span>
                <span style={styles.infoValue}>
                  {formatAmount(result.parsed.amount_usd, 'USD')}
                </span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>합계</span>
                <span style={{ ...styles.infoValue, fontWeight: 700, color: '#7c3aed' }}>
                  {formatAmount(result.parsed.total, result.parsed.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* 항목 목록 */}
          {result.parsed.items.length > 0 && (
            <div style={styles.card}>
              <h2 style={styles.sectionTitle}>청구 항목</h2>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>항목</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {result.parsed.items.map((item, i) => (
                    <tr key={i} style={styles.tr}>
                      <td style={styles.td}>{item.description}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {item.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 불일치 경고 */}
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>
              원장 대조 결과{' '}
              {result.discrepancies.length > 0 && (
                <span style={styles.warnBadge}>{result.discrepancies.length}건 불일치</span>
              )}
            </h2>

            {result.discrepancies.length === 0 ? (
              <div style={styles.okBox}>
                <span style={styles.okIcon}>✓</span>
                <span>불일치 항목이 없습니다.</span>
              </div>
            ) : (
              <div style={styles.discrepancyList}>
                {result.discrepancies.map((d, i) => (
                  <div key={i} style={styles.discrepancyItem}>
                    <div style={styles.discrepancyType}>{d.type}</div>
                    <p style={styles.discrepancyDesc}>{d.description}</p>
                    <div style={styles.discrepancyAmounts}>
                      {d.invoice_amount !== null && (
                        <span style={styles.amountChipRed}>
                          인보이스: {d.invoice_amount.toLocaleString()}원
                        </span>
                      )}
                      {d.ledger_amount !== null && (
                        <span style={styles.amountChipBlue}>
                          원장: {d.ledger_amount.toLocaleString()}원
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 원장 엔트리 요약 */}
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>
              최근 30일 원장 엔트리{' '}
              <span style={styles.countBadge}>{result.ledger_entries.length}건</span>
            </h2>
            {result.ledger_entries.length === 0 ? (
              <p style={styles.emptyText}>조회된 원장 항목이 없습니다.</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>일시</th>
                    <th style={styles.th}>계정</th>
                    <th style={styles.th}>유형</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>금액</th>
                    <th style={styles.th}>메모</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ledger_entries.slice(0, 20).map((e, i) => (
                    <tr key={i} style={styles.tr}>
                      <td style={{ ...styles.td, fontSize: 11, color: '#9ca3af' }}>
                        {e.created_at ? fmtDateISO(e.created_at) : '-'}
                      </td>
                      <td style={styles.td}>{e.account ?? '-'}</td>
                      <td style={styles.td}>{e.entry_type ?? '-'}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {e.amount !== null && e.amount !== undefined
                          ? Number(e.amount).toLocaleString()
                          : '-'}
                      </td>
                      <td style={{ ...styles.td, color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.memo ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.ledger_entries.length > 20 && (
              <p style={styles.moreText}>...외 {result.ledger_entries.length - 20}건 (최대 200건 조회)</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Linear/Stripe 톤 — admin 토큰 hex 값 직접 매핑
const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 860,
    margin: '0 auto',
    padding: '24px 16px 32px',
    fontFamily: "'Pretendard', 'Inter', sans-serif",
    color: '#0F172A',
  },
  pageTitle: { fontSize: 24, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.02em', color: '#0F172A' },
  pageDesc: { fontSize: 13, color: '#64748B', marginBottom: 24 },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  sectionTitle: { fontSize: 16, fontWeight: 600, margin: '0 0 16px', letterSpacing: '-0.015em', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 },
  dropzone: {
    border: '2px dashed #CBD5E1',
    borderRadius: 8,
    minHeight: 160,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
    marginBottom: 12,
    transition: 'border-color 0.16s',
  },
  dropzonePlaceholder: { textAlign: 'center', padding: 24 },
  uploadIcon: { fontSize: 36, marginBottom: 8 },
  dropzoneText: { fontSize: 14, color: '#334155', margin: '0 0 4px' },
  dropzoneHint: { fontSize: 12, color: '#94A3B8', margin: 0 },
  previewImg: { maxWidth: '100%', maxHeight: 300, objectFit: 'contain' },
  fileName: { fontSize: 12, color: '#64748B', margin: '0 0 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  optionRow: { marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: '#334155', fontWeight: 500, marginBottom: 6 },
  input: {
    width: '100%',
    height: 36,
    padding: '0 12px',
    border: '1px solid #E5E7EB',
    borderRadius: 6,
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none',
    background: '#FFFFFF',
    color: '#0F172A',
  },
  btnActive: {
    background: '#3182F6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
    transition: 'background 0.16s',
  },
  btnDisabled: {
    background: '#E5E7EB',
    color: '#94A3B8',
    border: 'none',
    borderRadius: 6,
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'not-allowed',
    width: '100%',
  },
  errorText: { color: '#F04452', fontSize: 13, marginTop: 10 },
  infoGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  infoItem: { display: 'flex', flexDirection: 'column', gap: 4 },
  infoLabel: { fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' },
  infoValue: { fontSize: 15, color: '#0F172A', fontFeatureSettings: '"tnum"' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    background: '#FFFFFF',
    padding: '0 12px',
    textAlign: 'left',
    fontWeight: 600,
    color: '#64748B',
    borderBottom: '1px solid #E5E7EB',
    fontSize: 12,
    height: 36,
    letterSpacing: '0.01em',
  },
  tr: { borderBottom: '1px solid #EEF2F6' },
  td: { padding: '9px 12px', color: '#334155', verticalAlign: 'middle', fontFeatureSettings: '"tnum"' },
  warnBadge: {
    background: '#FFFBEB',
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
  },
  okBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#E9FAF4',
    border: '1px solid rgba(4, 197, 132, 0.2)',
    borderRadius: 6,
    padding: '12px 16px',
    color: '#04C584',
    fontSize: 14,
  },
  okIcon: { fontWeight: 700, fontSize: 16 },
  discrepancyList: { display: 'flex', flexDirection: 'column', gap: 12 },
  discrepancyItem: {
    background: '#FFFBEB',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: 6,
    padding: '12px 16px',
  },
  discrepancyType: {
    fontSize: 11,
    fontWeight: 700,
    color: '#F59E0B',
    marginBottom: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  discrepancyDesc: { fontSize: 13, color: '#334155', margin: '0 0 8px' },
  discrepancyAmounts: { display: 'flex', gap: 8 },
  amountChipRed: {
    background: '#FFF1F2',
    color: '#F04452',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    fontFeatureSettings: '"tnum"',
  },
  amountChipBlue: {
    background: '#EBF3FE',
    color: '#3182F6',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    fontFeatureSettings: '"tnum"',
  },
  countBadge: {
    background: '#F1F5F9',
    color: '#64748B',
    fontSize: 12,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    fontFeatureSettings: '"tnum"',
  },
  emptyText: { color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: '16px 0' },
  moreText: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 8 },
};
