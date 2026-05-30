import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { fmtDateISO } from '@/lib/admin-utils';

Font.register({
  family: 'NotoSansKR',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/gh/notosans/notosans@main/hinted/NotoSansKR-Regular.woff2', fontWeight: 400 },
    { src: 'https://cdn.jsdelivr.net/gh/notosans/notosans@main/hinted/NotoSansKR-Bold.woff2', fontWeight: 700 },
  ],
});

const PRIMARY = '#001f3f';
const BG_LIGHT = '#f3f4f6';
const BORDER = '#d1d5db';
const BORDER_LIGHT = '#e5e7eb';
const TEXT_MUTED = '#666';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansKR',
    padding: 40,
    fontSize: 10,
    color: '#1a1a1a',
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: TEXT_MUTED, marginBottom: 20 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#333',
    borderBottom: `2px solid ${PRIMARY}`,
    paddingBottom: 3,
    marginBottom: 6,
  },
  table: { width: '100%' },
  th: {
    backgroundColor: BG_LIGHT,
    padding: '5 8',
    borderBottom: `1px solid ${BORDER}`,
    fontSize: 9,
    fontWeight: 700,
    textAlign: 'left',
  },
  td: {
    padding: '5 8',
    borderBottom: `1px solid ${BORDER_LIGHT}`,
    fontSize: 9,
  },
  thRight: {
    backgroundColor: BG_LIGHT,
    padding: '5 8',
    borderBottom: `1px solid ${BORDER}`,
    fontSize: 9,
    fontWeight: 700,
    textAlign: 'right',
  },
  tdRight: {
    padding: '5 8',
    borderBottom: `1px solid ${BORDER_LIGHT}`,
    fontSize: 9,
    textAlign: 'right',
  },
  totalRow: { backgroundColor: '#eef2ff' },
  infoRow: { flexDirection: 'row', marginBottom: 2 },
  infoLabel: { width: 80, color: TEXT_MUTED, fontSize: 9 },
  infoValue: { fontSize: 9 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  summaryCard: {
    width: '46%',
    backgroundColor: '#f9fafb',
    border: `1px solid ${BORDER_LIGHT}`,
    borderRadius: 4,
    padding: 10,
  },
  summaryLabel: { fontSize: 8, color: TEXT_MUTED },
  summaryValue: { fontSize: 16, fontWeight: 700, color: PRIMARY, marginTop: 2 },
  payoutCard: {
    width: '96%',
    backgroundColor: PRIMARY,
    borderRadius: 4,
    padding: 10,
    marginTop: 8,
  },
  payoutLabel: { fontSize: 8, color: '#8bb8ff' },
  payoutValue: { fontSize: 22, fontWeight: 700, color: 'white', marginTop: 2 },
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTop: `1px solid ${BORDER_LIGHT}`,
    fontSize: 8,
    color: '#999',
    textAlign: 'center',
  },
  note: { fontSize: 8, color: '#999', marginTop: 4 },
});

export interface SettlementPdfProps {
  affiliateName: string;
  referralCode: string;
  phone: string | null;
  payoutType: string;
  year: string;
  month: string;
  periodLabel: string;
  bookings: Array<{
    package_title: string;
    pax: number;
    base_amount: number;
    commission: number;
    departure_date: string;
    return_date: string | null;
  }>;
  breakdownTotals: { base: number; tier: number; campaigns: number; capped: number };
  totalAmount: number;
  carryoverBalance: number;
  finalTotal: number;
  taxDeduction: number;
  finalPayout: number;
}

export function SettlementPdfDocument(props: SettlementPdfProps) {
  const {
    affiliateName, referralCode, phone, payoutType,
    year, month, periodLabel,
    bookings, breakdownTotals,
    totalAmount, carryoverBalance, finalTotal, taxDeduction, finalPayout,
  } = props;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>여소남 어필리에이트 정산 내역서</Text>
        <Text style={styles.subtitle}>
          정산 기간: {periodLabel} | 파트너: {affiliateName} ({referralCode})
        </Text>

        {/* 파트너 정보 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>파트너 정보</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>파트너명</Text>
            <Text style={styles.infoValue}>{affiliateName}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>연락처</Text>
            <Text style={styles.infoValue}>{phone || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>추천코드</Text>
            <Text style={styles.infoValue}>{referralCode}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>정산유형</Text>
            <Text style={styles.infoValue}>
              {payoutType === 'PERSONAL' ? '개인 (원천세 3.3%)' : '사업자'}
            </Text>
          </View>
        </View>

        {/* 귀속 예약 목록 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            귀속 예약 목록 ({bookings.length}건)
          </Text>
          <View style={styles.table}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[styles.th, { width: '30%' }]}>상품명</Text>
              <Text style={[styles.thRight, { width: '12%' }]}>인원</Text>
              <Text style={[styles.thRight, { width: '18%' }]}>기준금액</Text>
              <Text style={[styles.thRight, { width: '18%' }]}>커미션</Text>
              <Text style={[styles.th, { width: '11%' }]}>출발일</Text>
              <Text style={[styles.th, { width: '11%' }]}>귀국일</Text>
            </View>
            {bookings.map((b, i) => (
              <View key={i} style={{ flexDirection: 'row' }}>
                <Text style={[styles.td, { width: '30%' }]}>{b.package_title || '-'}</Text>
                <Text style={[styles.tdRight, { width: '12%' }]}>{b.pax}명</Text>
                <Text style={[styles.tdRight, { width: '18%' }]}>{b.base_amount.toLocaleString()}원</Text>
                <Text style={[styles.tdRight, { width: '18%' }]}>{b.commission.toLocaleString()}원</Text>
                <Text style={[styles.td, { width: '11%' }]}>{b.departure_date}</Text>
                <Text style={[styles.td, { width: '11%' }]}>{b.return_date || '-'}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', backgroundColor: '#eef2ff' }}>
              <Text style={[styles.td, { width: '42%', fontWeight: 700 }]}>합계</Text>
              <Text style={[styles.tdRight, { width: '18%', fontWeight: 700 }]}>{totalAmount.toLocaleString()}원</Text>
              <Text style={[styles.td, { width: '40%' }]}></Text>
            </View>
          </View>
        </View>

        {/* 커미션 구성 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>커미션 구성 (가산식 분해)</Text>
          <View style={styles.table}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[styles.th, { width: '40%' }]}>구분</Text>
              <Text style={[styles.thRight, { width: '25%' }]}>합계</Text>
              <Text style={[styles.th, { width: '35%' }]}>비고</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[styles.td, { width: '40%' }]}>상품 기본 커미션</Text>
              <Text style={[styles.tdRight, { width: '25%' }]}>{breakdownTotals.base.toLocaleString()}원</Text>
              <Text style={[styles.td, { width: '35%', color: TEXT_MUTED }]}>상품별 고정율</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[styles.td, { width: '40%' }]}>등급 보너스</Text>
              <Text style={[styles.tdRight, { width: '25%' }]}>{breakdownTotals.tier.toLocaleString()}원</Text>
              <Text style={[styles.td, { width: '35%', color: TEXT_MUTED }]}>{affiliateName}님 현재 등급 적용</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[styles.td, { width: '40%' }]}>캠페인 가산</Text>
              <Text style={[styles.tdRight, { width: '25%' }]}>{breakdownTotals.campaigns.toLocaleString()}원</Text>
              <Text style={[styles.td, { width: '35%', color: TEXT_MUTED }]}>
                {breakdownTotals.capped > 0 ? `⚠️ ${breakdownTotals.capped}건 캡 적용` : '캠페인 합산'}
              </Text>
            </View>
          </View>
          <Text style={styles.note}>* 각 예약은 예약 시점 정책으로 동결</Text>
        </View>

        {/* 정산 요약 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>정산 요약</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>당월 발생 수수료</Text>
              <Text style={styles.summaryValue}>{totalAmount.toLocaleString()}원</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>전월 이월</Text>
              <Text style={styles.summaryValue}>{carryoverBalance.toLocaleString()}원</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>합계 (세전)</Text>
              <Text style={styles.summaryValue}>{finalTotal.toLocaleString()}원</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>
                {payoutType === 'PERSONAL' ? '원천세 (3.3%)' : '세금계산서 별도'}
              </Text>
              <Text style={styles.summaryValue}>{taxDeduction.toLocaleString()}원</Text>
            </View>
          </View>
          <View style={styles.payoutCard}>
            <Text style={styles.payoutLabel}>실지급액</Text>
            <Text style={styles.payoutValue}>{finalPayout.toLocaleString()}원</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          여소남 | 이 문서는 자동 생성되었습니다. | 발행일: {fmtDateISO(new Date().toISOString())}
        </Text>
      </Page>
    </Document>
  );
}
