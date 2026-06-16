import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  BarChart4,
  BookCopy,
  BookOpen,
  BookOpenCheck,
  Bot,
  Building2,
  Calculator,
  ClipboardCheck,
  Coins,
  Combine,
  Compass,
  Eye,
  FileQuestion,
  FileSearch,
  FolderKanban,
  GitBranch,
  Globe,
  Handshake,
  Headset,
  Inbox,
  Layers,
  LayoutDashboard,
  LibraryBig,
  Link2,
  MapPinned,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Mountain,
  Newspaper,
  Package,
  PencilLine,
  Plane,
  Receipt,
  ScrollText,
  Search as SearchIcon,
  Settings,
  Shield,
  Siren,
  SlidersHorizontal,
  Sparkles as Sparkle,
  Star,
  Tags,
  Target,
  Timer,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Wallet,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import {
  hasMenuAccess,
  type AdminBadgeCounts,
  type MenuRoleLevel,
} from '@/lib/admin-mission-control';

export type AdminNavDomain =
  | 'operations'
  | 'products'
  | 'sales'
  | 'finance'
  | 'marketing'
  | 'ai'
  | 'system';

export type AdminNavBadgeKey =
  | 'pendingActions'
  | 'pendingPackages'
  | 'unmatchedPending'
  | 'paymentUnmatched'
  | 'blogQueue';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  minRole?: MenuRoleLevel;
  domain?: AdminNavDomain;
  badgeKey?: AdminNavBadgeKey;
  primaryAction?: string;
  searchKeywords?: string[];
}

export interface NavDivider {
  divider: true;
  label: string;
}

export interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: (NavItem | NavDivider)[];
  minRole?: MenuRoleLevel;
}

export const adminNavGroups: NavGroup[] = [
  {
    title: '운영',
    icon: LayoutDashboard,
    items: [
      { href: '/admin', label: '대시보드', icon: LayoutDashboard, exact: true },
      { href: '/admin/inbox', label: '예약 액션큐', icon: Inbox },
      { href: '/admin/leads', label: '예약 문의', icon: MessageSquare },
      { href: '/admin/bookings', label: '예약 관리', icon: BookOpenCheck },
      { href: '/admin/customers', label: '고객 관리', icon: Users },
      { href: '/admin/reviews', label: '리뷰 분석', icon: Star },
      { href: '/admin/flight-alerts', label: '항공 지연', icon: Plane },
    ],
  },
  {
    title: '상품·공급',
    icon: Package,
    items: [
      { href: '/admin/packages', label: '상품 관리', icon: Package },
      {
        href: '/admin/packages?status=pending',
        label: '상품 검수',
        icon: ClipboardCheck,
        domain: 'products',
        badgeKey: 'pendingPackages',
        primaryAction: '공개 전 확인',
        searchKeywords: ['승인 대기', '검수 대기', 'pending package', '상품 승인'],
      },
      { href: '/admin/upload', label: '상품 업로드', icon: Upload },
      { href: '/admin/product-registration-drafts', label: 'V3 Draft Ledger', icon: FileSearch },
      { href: '/admin/land-operators', label: '랜드사 관리', icon: Building2, minRole: 'tenant_admin' },
      { href: '/admin/attractions', label: '여행지/관광지', icon: Mountain },
      {
        href: '/admin/attractions/unmatched',
        label: '관광지 매칭',
        icon: SearchIcon,
        domain: 'products',
        badgeKey: 'unmatchedPending',
        primaryAction: 'DB 연결',
        searchKeywords: ['미매칭 관광지', 'unmatched attraction', '일정 매칭', '관광지 DB'],
      },
      { href: '/admin/destinations', label: '목적지 관리', icon: MapPinned },
      { href: '/admin/departing-locations', label: '출발지 관리', icon: Globe },
      { href: '/admin/terms-templates', label: '약관 템플릿', icon: ScrollText, minRole: 'tenant_admin' },
      { href: '/admin/products/assemble-free-travel', label: '자유여행 상품 조립', icon: Combine, minRole: 'tenant_admin' },
    ],
  },
  {
    title: '영업·제휴',
    icon: BarChart3,
    minRole: 'tenant_admin',
    items: [
      { href: '/admin/rfqs', label: '단체 RFQ', icon: FileQuestion },
      { href: '/admin/concierge', label: '컨시어지', icon: Headset },
      { href: '/admin/free-travel', label: '자유여행 플래너', icon: Compass },
      { href: '/admin/affiliates', label: '제휴/인플루언서', icon: Handshake },
      { href: '/admin/affiliate-analytics', label: '제휴 분석', icon: BarChart3 },
      { href: '/admin/affiliate-promo-report', label: '프로모코드 성과', icon: Tags },
      { href: '/admin/applications', label: '파트너 신청', icon: UserPlus },
      { href: '/admin/partner-preview', label: '파트너 프론트 미리보기', icon: Eye },
      { href: '/admin/competitor-prices', label: '경쟁사 가격', icon: TrendingUp },
      { href: '/admin/analytics', label: 'LTV 코호트', icon: BarChart3 },
      { href: '/admin/tenants', label: '테넌트 관리', icon: Layers, minRole: 'platform_admin' },
    ],
  },
  {
    title: '재무',
    icon: Wallet,
    minRole: 'tenant_admin',
    items: [
      {
        href: '/admin/payments',
        label: '입금 관리',
        icon: Wallet,
        domain: 'finance',
        badgeKey: 'paymentUnmatched',
        primaryAction: '수동 매칭',
        searchKeywords: ['입금 매칭', '미매칭 입금', '대기 거래', 'bank transaction'],
      },
      { href: '/admin/payments/reconcile', label: '입금 정합성', icon: ArrowLeftRight },
      { href: '/admin/ledger', label: '통합 장부', icon: BookCopy },
      { href: '/admin/settlements', label: '제휴 정산', icon: Coins },
      { href: '/admin/land-settlements', label: '랜드사 정산', icon: BadgeDollarSign },
      { href: '/admin/tax', label: '세무 관리', icon: Calculator },
      { href: '/admin/invoice', label: '인보이스 파싱', icon: Receipt },
    ],
  },
  {
    title: '마케팅·콘텐츠',
    icon: Megaphone,
    items: [
      { href: '/admin/marketing', label: '마케팅 대시보드', icon: Megaphone },
      { href: '/admin/ad-os', label: 'Ad OS', icon: Bot, minRole: 'tenant_admin' },
      { href: '/admin/marketing/command-center', label: '마케팅 커맨드센터', icon: Target, minRole: 'tenant_admin' },
      { href: '/admin/marketing/system-health', label: '마케팅 시스템 점검', icon: Activity, minRole: 'tenant_admin' },
      { href: '/admin/marketing/card-news', label: '카드뉴스', icon: Newspaper },
      { href: '/admin/content-hub', label: '콘텐츠', icon: FolderKanban },
      { href: '/admin/search-ads', label: '검색광고', icon: SearchIcon },
      { href: '/admin/blog', label: '블로그', icon: BookOpen },
      {
        href: '/admin/blog/queue',
        label: '블로그 큐',
        icon: Newspaper,
        domain: 'marketing',
        badgeKey: 'blogQueue',
        primaryAction: '발행 준비',
        searchKeywords: ['네이버 블로그', '블로그 초안', '콘텐츠 발행'],
      },
      { href: '/admin/marketing-intelligence', label: '마케팅 인텔리전스', icon: BarChart4, minRole: 'tenant_admin' },
      { href: '/admin/tmp-pipeline', label: 'TMP 파이프라인', icon: GitBranch, minRole: 'tenant_admin' },
      { href: '/admin/marketing/creatives', label: '크리에이티브', icon: Sparkle },
      { href: '/admin/tenant-tokens', label: 'API 토큰 관리', icon: SlidersHorizontal, minRole: 'tenant_admin' },
    ],
  },
  {
    title: 'AI·자동화',
    icon: Bot,
    minRole: 'tenant_admin',
    items: [
      {
        href: '/admin/jarvis',
        label: '자비스 AI',
        icon: Bot,
        domain: 'ai',
        badgeKey: 'pendingActions',
        primaryAction: '승인/반려',
        searchKeywords: ['자비스 결재', 'AI 액션', 'agent action', '승인 대기'],
      },
      { href: '/admin/qa', label: 'Q&A 챗봇', icon: MessageCircle },
      { href: '/admin/generate', label: 'AI 생성', icon: Wand2 },
      { href: '/admin/jarvis/rag', label: 'RAG 검색', icon: SearchIcon },
      { href: '/admin/mcp', label: 'MCP 게이트웨이', icon: Link2 },
      { href: '/admin/platform-learning', label: 'AI 플라이휠', icon: LibraryBig, minRole: 'platform_admin' },
      { href: '/admin/agent-mas', label: 'MAS 관제', icon: GitBranch, minRole: 'platform_admin' },
      { href: '/admin/extractions/corrections', label: 'AI 파싱 교정 이력', icon: PencilLine, minRole: 'platform_admin' },
      { href: '/admin/prompts', label: '프롬프트 레지스트리', icon: SlidersHorizontal, minRole: 'platform_admin' },
    ],
  },
  {
    title: '시스템',
    icon: Activity,
    minRole: 'platform_admin',
    items: [
      { href: '/admin/control-tower', label: 'OS 관제탑', icon: Activity },
      { href: '/admin/ops', label: '크론·작업', icon: Timer },
      { href: '/admin/scoring', label: '점수 정책', icon: Star },
      { href: '/admin/alerts', label: '운영 알림', icon: AlertTriangle },
      { href: '/admin/escalations', label: '에스컬레이션', icon: Siren },
      { href: '/admin/gdpr', label: '개인정보 삭제', icon: Shield },
      { href: '/admin/settings/integrations', label: '외부 플랫폼 연동', icon: Settings },
    ],
  },
];

const badgeReaders: Record<AdminNavBadgeKey, (counts: AdminBadgeCounts | undefined) => number> = {
  pendingActions: (counts) => counts?.pendingActions ?? 0,
  pendingPackages: (counts) => counts?.pendingPackages ?? 0,
  unmatchedPending: (counts) => counts?.unmatchedPending ?? 0,
  paymentUnmatched: (counts) => counts?.paymentUnmatched ?? counts?.ledgerDrift ?? 0,
  blogQueue: (counts) => counts?.blogQueue ?? 0,
};

export function getNavItemBadge(
  item: NavItem,
  counts: AdminBadgeCounts | undefined,
): number | undefined {
  if (!item.badgeKey) return undefined;
  const count = badgeReaders[item.badgeKey](counts);
  return count > 0 ? count : undefined;
}

export function filterNavGroups(groups: NavGroup[], role: string | undefined): NavGroup[] {
  return groups
    .filter((group) => hasMenuAccess(role, group.minRole))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if ('divider' in item) return false;
        return hasMenuAccess(role, item.minRole);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function flattenNavItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items.filter((item): item is NavItem => !('divider' in item)));
}

export const allAdminNavItems = flattenNavItems(adminNavGroups);
