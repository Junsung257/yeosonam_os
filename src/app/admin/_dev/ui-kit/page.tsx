'use client';

/**
 * /admin/_dev/ui-kit — 어드민 디자인 시스템 쇼케이스
 *
 * Phase 1~3 산출물의 살아있는 카탈로그. Storybook 미사용이므로 이 페이지가 catalog.
 * 신규 토큰·primitive·패턴을 한 화면에서 시각 검증.
 */

import { useState } from 'react';
import {
  StatusBadge,
  AlertIndicator,
  SearchInput,
  DataTable,
  DensityToggle,
  SHORTCUT_REGISTRY,
  type ColumnDef,
} from '@/components/admin/ui';
import {
  PageHeader,
  SectionCard,
  KpiCard,
  FilterBar,
  EmptyState,
  DetailDrawer,
  FormRow,
  StatNumber,
} from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Chip from '@/components/ui/Chip';
import Modal from '@/components/ui/Modal';
import {
  Keyboard, BookOpenCheck, Wallet, TrendingUp, Users, Inbox,
  Plus, Filter, Download,
} from 'lucide-react';

interface DemoRow {
  id: string;
  name: string;
  status: string;
  amount: number;
  date: string;
  alert?: 'critical' | 'warning' | null;
}

const demoRows: DemoRow[] = [
  { id: 'B-001', name: '김여행',     status: 'fully_paid',      amount: 1_990_000, date: '2026-05-12', alert: null },
  { id: 'B-002', name: '이고객',     status: 'waiting_deposit', amount:   890_000, date: '2026-05-15', alert: 'warning' },
  { id: 'B-003', name: '박패키지',   status: 'cancelled',       amount: 2_300_000, date: '2026-05-20', alert: 'critical' },
  { id: 'B-004', name: '최예약',     status: 'deposit_paid',    amount: 1_550_000, date: '2026-05-22', alert: null },
];

const columns: ColumnDef<DemoRow>[] = [
  { key: 'id',     header: '예약번호', priority: 1, cell: (r) => <span className="font-mono">{r.id}</span> },
  { key: 'name',   header: '고객명',   priority: 1, cell: (r) => r.name },
  { key: 'status', header: '상태',     priority: 1, cell: (r) => <StatusBadge kind="booking" value={r.status} /> },
  { key: 'amount', header: '금액',     priority: 2, align: 'right', cell: (r) => <StatNumber value={r.amount} format="currency" /> },
  { key: 'date',   header: '출발일',   priority: 2, cell: (r) => r.date },
  { key: 'memo',   header: '담당자',   priority: 3, cell: () => '여소남' },
];

export default function UiKitPage() {
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="max-w-6xl mx-auto py-2 space-y-8">
      <PageHeader
        title="어드민 디자인 시스템"
        subtitle="Phase 1~3 산출물 — 토큰·Primitive·패턴 라이브러리 통합 쇼케이스"
        breadcrumb={[{ label: '개발', href: '/admin' }, { label: 'UI Kit' }]}
        badge={<Chip variant="primary">v2.0 Linear/Stripe 톤</Chip>}
        actions={
          <>
            <DensityToggle />
            <Button variant="ghost" size="sm">
              <Download size={14} />
              토큰 내보내기
            </Button>
          </>
        }
      />

      {/* ── KPI Cards ───────────────────────────────────── */}
      <section>
        <div className="admin-section-title mb-3">KPI Card · 패턴</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="신규 예약"
            value="234"
            unit="건"
            delta="+12.4%"
            tone="positive"
            icon={BookOpenCheck}
            hint="vs. 지난 7일"
          />
          <KpiCard
            label="확정 매출"
            value="₩12.4M"
            delta="+8.3%"
            tone="positive"
            icon={Wallet}
            hint="이번 달"
          />
          <KpiCard
            label="평균 객단가"
            value="₩890K"
            delta="-2.1%"
            tone="negative"
            icon={TrendingUp}
          />
          <KpiCard
            label="액티브 고객"
            value="1,892"
            delta="+0.0%"
            tone="neutral"
            icon={Users}
            hint="지난 30일"
          />
        </div>
      </section>

      {/* ── Buttons ────────────────────────────────────── */}
      <SectionCard title="Button · Primitive">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm">Primary sm</Button>
          <Button variant="primary" size="md">Primary md</Button>
          <Button variant="primary" size="lg">Primary lg</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading>Loading</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
      </SectionCard>

      {/* ── Inputs / Form ───────────────────────────────── */}
      <SectionCard title="Form · Pattern · FormRow + Input + Chip">
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
          <FormRow label="고객명" required>
            <Input placeholder="홍길동" />
          </FormRow>
          <FormRow label="연락처" required hint="010-0000-0000 형식">
            <Input placeholder="010-0000-0000" />
          </FormRow>
          <FormRow label="이메일" error="유효한 이메일을 입력하세요">
            <Input placeholder="hello@example.com" defaultValue="invalid" />
          </FormRow>
          <FormRow label="태그">
            <div className="flex flex-wrap gap-1.5">
              <Chip variant="primary">VIP</Chip>
              <Chip variant="ghost">신규</Chip>
              <Chip variant="warning">요주의</Chip>
              <Chip variant="success">완료</Chip>
              <Chip variant="danger">취소</Chip>
            </div>
          </FormRow>
        </div>
      </SectionCard>

      {/* ── StatusBadge ───────────────────────────────── */}
      <SectionCard title="StatusBadge · Primitive">
        <div className="flex flex-wrap gap-2">
          <StatusBadge kind="booking" value="pending" />
          <StatusBadge kind="booking" value="waiting_deposit" />
          <StatusBadge kind="booking" value="deposit_paid" />
          <StatusBadge kind="booking" value="fully_paid" />
          <StatusBadge kind="booking" value="cancelled" />
          <StatusBadge kind="package" value="approved" />
          <StatusBadge kind="package" value="pending" />
          <StatusBadge kind="package" value="archived" />
          <StatusBadge kind="audit" value="clean" />
          <StatusBadge kind="audit" value="warnings" />
          <StatusBadge kind="audit" value="blocked" />
          <StatusBadge kind="grade" value="VVIP" />
          <StatusBadge kind="grade" value="우수" />
          <StatusBadge kind="grade" value="일반" />
          <StatusBadge kind="custom" tone="info" value="info" label="알림" withDot />
        </div>
      </SectionCard>

      {/* ── AlertIndicator ─────────────────────────────── */}
      <SectionCard title="AlertIndicator · Primitive">
        <div className="flex gap-4">
          <AlertIndicator level="critical" tooltip="치명 오류" />
          <AlertIndicator level="warning"  tooltip="경고" />
          <AlertIndicator level="info"     tooltip="정보" />
          <AlertIndicator level="ok"       tooltip="정상" />
        </div>
      </SectionCard>

      {/* ── Search & Cmd-K ────────────────────────────── */}
      <SectionCard
        title={<span className="flex items-center gap-2"><Keyboard size={16} className="text-admin-muted" />단축키 & 명령 팔레트</span>}
      >
        <div className="space-y-3">
          <p className="text-admin-sm text-admin-muted">
            <kbd>⌘ K</kbd> 또는 <kbd>Ctrl K</kbd> — 명령 팔레트 열기.
            <kbd>?</kbd> — 단축키 도움말.
            G + 영문키 시퀀스로 페이지 이동.
          </p>
          <div className="flex flex-wrap gap-3">
            <SearchInput variant="topbar" placeholder="통합검색..." kbd="⌘K" width="240px" />
            <SearchInput variant="inline" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="고객명, 예약번호" width="280px" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-admin-sm">
            {SHORTCUT_REGISTRY.slice(0, 8).map((s) => (
              <div key={s.keys + s.label} className="flex items-center gap-2 px-2.5 py-1.5 rounded-admin-sm bg-admin-surface-2">
                <span className="flex gap-1 shrink-0">
                  {s.keys.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}
                </span>
                <span className="text-admin-muted truncate">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* ── DataTable + FilterBar ───────────────────────── */}
      <section>
        <div className="admin-section-title mb-3">DataTable · Primitive (행 클릭 + alert 슬롯 + zebra)</div>
        <FilterBar
          right={
            <>
              <Button variant="ghost" size="sm"><Filter size={14} />필터</Button>
              <Button variant="primary" size="sm"><Plus size={14} />신규</Button>
            </>
          }
        >
          <SearchInput variant="inline" placeholder="검색" width="240px" />
          <Chip variant="ghost">전체 234</Chip>
          <Chip variant="warning">대기 18</Chip>
        </FilterBar>
        <DataTable<DemoRow>
          columns={columns}
          rows={demoRows}
          getRowKey={(r) => r.id}
          alertCell={(r) => r.alert ? { level: r.alert, tooltip: r.alert === 'critical' ? '취소된 예약' : '계약금 대기' } : null}
          onRowClick={() => setDrawerOpen(true)}
          zebra
        />
      </section>

      {/* ── EmptyState ────────────────────────────── */}
      <SectionCard title="EmptyState · 패턴">
        <EmptyState
          icon={Inbox}
          title="새 알림이 없습니다"
          description="모든 처리가 완료되었습니다. 새로운 활동이 들어오면 여기에 표시됩니다."
          action={<Button variant="secondary" size="sm">설정으로 이동</Button>}
        />
      </SectionCard>

      {/* ── 톤 비교 (Before/After) ────────────────────── */}
      <SectionCard title="톤 가이드 · 어드민에서 쓰면 안 되는 패턴">
        <div className="grid md:grid-cols-2 gap-4 text-admin-sm">
          <div className="p-4 rounded-admin-lg border border-admin-border-mid bg-white shadow-admin-sm">
            <p className="font-semibold text-admin-text mb-1">❌ 공개사이트 톤 (Toss)</p>
            <p className="text-admin-muted">rounded-admin-lg + soft shadow + slate-* 인라인 토큰. 어드민에선 정보 밀도가 떨어짐.</p>
          </div>
          <div className="admin-card p-4">
            <p className="font-semibold text-admin-text mb-1">✅ Linear/Stripe 톤</p>
            <p className="text-admin-muted">rounded-admin-md + crisp hairline + admin-* 토큰. 데이터 밀도 우선.</p>
          </div>
        </div>
      </SectionCard>

      {/* ── Modal / Drawer 데모 ───────────────────────── */}
      <SectionCard title="Modal · Drawer · 패턴">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>모달 열기</Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>드로어 열기</Button>
        </div>
      </SectionCard>

      {/* ── Modal ─────────────────────────────────── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="p-6">
          <h2 className="text-admin-h3 text-admin-text mb-2">예약 취소 확인</h2>
          <p className="text-admin-sm text-admin-muted mb-5">
            이 작업은 되돌릴 수 없습니다. 정말로 예약 #B-002를 취소하시겠습니까?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>취소</Button>
            <Button variant="danger" onClick={() => setModalOpen(false)}>예약 취소</Button>
          </div>
        </div>
      </Modal>

      {/* ── Detail Drawer ─────────────────────────── */}
      <DetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="예약 상세"
        subtitle="#B-002 · 이고객"
        actions={
          <>
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>닫기</Button>
            <Button variant="primary">예약 확정</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-admin-sm">
            <div>
              <div className="text-admin-xs text-admin-muted mb-1">상태</div>
              <StatusBadge kind="booking" value="waiting_deposit" />
            </div>
            <div>
              <div className="text-admin-xs text-admin-muted mb-1">금액</div>
              <StatNumber value={890000} format="currency" />
            </div>
            <div>
              <div className="text-admin-xs text-admin-muted mb-1">출발일</div>
              <span className="font-mono text-admin-text">2026-05-15</span>
            </div>
            <div>
              <div className="text-admin-xs text-admin-muted mb-1">담당자</div>
              <span>여소남</span>
            </div>
          </div>
          <div className="border-t border-admin-border pt-4">
            <h3 className="text-admin-base font-semibold text-admin-text mb-2">처리 이력</h3>
            <ul className="space-y-2 text-admin-sm text-admin-text-2">
              <li className="flex items-start gap-2">
                <span className="text-admin-muted-2 font-mono shrink-0">10:24</span>
                계약금 입금 안내 발송
              </li>
              <li className="flex items-start gap-2">
                <span className="text-admin-muted-2 font-mono shrink-0">10:18</span>
                예약 신청 접수
              </li>
            </ul>
          </div>
        </div>
      </DetailDrawer>
    </div>
  );
}
