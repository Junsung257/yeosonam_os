'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface OperatorInfo {
  id: string;
  name: string;
}

interface PackageItem {
  id: string;
  title: string;
  destination: string;
  status: string;
  price_dates: unknown;
}

interface BookingItem {
  booking_no: string;
  package_title: string;
  departure_date: string | null;
  adult_count: number;
  status: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  deposit_paid: '계약금 입금',
  waiting_balance: '잔금 대기',
  fully_paid: '완납',
  pending: '대기',
  waiting_deposit: '입금 대기',
  cancelled: '취소',
};

const STATUS_COLOR: Record<string, string> = {
  deposit_paid: '#f59e0b',
  waiting_balance: '#3b82f6',
  fully_paid: '#10b981',
  pending: '#6b7280',
  waiting_deposit: '#6b7280',
  cancelled: '#ef4444',
};

export default function PartnerPortalPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [operator, setOperator] = useState<OperatorInfo | null>(null);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'packages' | 'bookings'>('packages');

  useEffect(() => {
    if (!token) return;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function fetchData() {
    setLoading(true);
    setError(null);

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      const [pkgRes, bookRes] = await Promise.all([
        fetch('/api/partner/packages', { headers }),
        fetch('/api/partner/bookings', { headers }),
      ]);

      const pkgData = await pkgRes.json();
      const bookData = await bookRes.json();

      if (!pkgRes.ok) {
        setError(pkgData.error ?? '패키지 조회 실패');
        setLoading(false);
        return;
      }
      if (!bookRes.ok) {
        setError(bookData.error ?? '예약 조회 실패');
        setLoading(false);
        return;
      }

      setOperator(pkgData.operator ?? null);
      setPackages(pkgData.packages ?? []);
      setBookings(bookData.bookings ?? []);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <h1 style={styles.title}>랜드사 파트너 포털</h1>
          <p style={styles.errorText}>
            URL에 <code style={styles.code}>?token=YOUR_TOKEN</code> 을 포함해주세요.
          </p>
          <p style={styles.hint}>예: /partner?token=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <p style={styles.loadingText}>불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.centered}>
        <div style={styles.card}>
          <h1 style={styles.title}>인증 오류</h1>
          <p style={styles.errorText}>{error}</p>
        </div>
      </div>
    );
  }

  if (!operator) return null;

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.headerTitle}>파트너 포털</h1>
          <p style={styles.headerSub}>{operator.name}</p>
        </div>
        <span style={styles.badge}>랜드사</span>
      </div>

      {/* 요약 카드 */}
      <div style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryNum}>{packages.length}</div>
          <div style={styles.summaryLabel}>전체 행사</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={{ ...styles.summaryNum, color: '#10b981' }}>{bookings.length}</div>
          <div style={styles.summaryLabel}>확정 예약</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={{ ...styles.summaryNum, color: '#3b82f6' }}>
            {bookings.filter(b => b.status === 'fully_paid').length}
          </div>
          <div style={styles.summaryLabel}>완납</div>
        </div>
      </div>

      {/* 탭 */}
      <div style={styles.tabRow}>
        <button
          style={activeTab === 'packages' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('packages')}
        >
          행사 목록 ({packages.length})
        </button>
        <button
          style={activeTab === 'bookings' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('bookings')}
        >
          확정 고객 명단 ({bookings.length})
        </button>
      </div>

      {/* 패키지 테이블 */}
      {activeTab === 'packages' && (
        <div style={styles.tableWrap}>
          {packages.length === 0 ? (
            <p style={styles.emptyText}>등록된 행사가 없습니다.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>상품명</th>
                  <th style={styles.th}>목적지</th>
                  <th style={styles.th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {packages.map(pkg => (
                  <tr key={pkg.id} style={styles.tr}>
                    <td style={styles.td}>{pkg.title}</td>
                    <td style={styles.td}>{pkg.destination}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusChip,
                          background: STATUS_COLOR[pkg.status] ?? '#6b7280',
                        }}
                      >
                        {STATUS_LABEL[pkg.status] ?? pkg.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 예약 테이블 */}
      {activeTab === 'bookings' && (
        <div style={styles.tableWrap}>
          {bookings.length === 0 ? (
            <p style={styles.emptyText}>확정된 예약이 없습니다.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>예약번호</th>
                  <th style={styles.th}>상품명</th>
                  <th style={styles.th}>출발일</th>
                  <th style={styles.th}>인원</th>
                  <th style={styles.th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => (
                  <tr key={b.booking_no} style={styles.tr}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>
                      {b.booking_no}
                    </td>
                    <td style={styles.td}>{b.package_title}</td>
                    <td style={styles.td}>
                      {b.departure_date
                        ? new Date(b.departure_date).toLocaleDateString('ko-KR')
                        : '-'}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{b.adult_count}명</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.statusChip,
                          background: STATUS_COLOR[b.status] ?? '#6b7280',
                        }}
                      >
                        {STATUS_LABEL[b.status] ?? b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <p style={styles.footer}>여소남 파트너 포털 · 데이터는 실시간으로 반영됩니다</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 900,
    margin: '0 auto',
    padding: '24px 16px',
    fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
    color: '#111827',
  },
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#f9fafb',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 40,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    textAlign: 'center',
    maxWidth: 480,
  },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 12 },
  errorText: { color: '#ef4444', fontSize: 14, marginBottom: 8 },
  hint: { color: '#9ca3af', fontSize: 13 },
  code: { background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 },
  loadingText: { color: '#6b7280', fontSize: 15 },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: '1px solid #e5e7eb',
  },
  headerTitle: { fontSize: 22, fontWeight: 700, margin: 0 },
  headerSub: { fontSize: 14, color: '#6b7280', margin: '4px 0 0' },
  badge: {
    background: '#ede9fe',
    color: '#7c3aed',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 20,
  },
  summaryRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 24,
  },
  summaryCard: {
    flex: 1,
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '16px 12px',
    textAlign: 'center',
  },
  summaryNum: {
    fontSize: 28,
    fontWeight: 700,
    color: '#111827',
    lineHeight: 1,
  },
  summaryLabel: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  tabRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
    borderBottom: '1px solid #e5e7eb',
  },
  tab: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '8px 16px',
    fontSize: 14,
    color: '#6b7280',
    cursor: 'pointer',
    marginBottom: -1,
  },
  tabActive: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid #7c3aed',
    padding: '8px 16px',
    fontSize: 14,
    color: '#7c3aed',
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: -1,
  },
  tableWrap: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    background: '#f9fafb',
    padding: '10px 14px',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 12,
  },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '10px 14px', color: '#374151', verticalAlign: 'middle' },
  statusChip: {
    display: 'inline-block',
    color: '#fff',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    padding: 40,
    fontSize: 14,
  },
  footer: {
    textAlign: 'center',
    color: '#d1d5db',
    fontSize: 12,
    marginTop: 32,
  },
};
