/**
 * Command Registry — ⌘K 팔레트가 노출하는 모든 정적 명령 카탈로그.
 *
 * 종류:
 *   - navigate : 페이지 이동
 *   - action   : 즉시 실행되는 액션 (테마/density/로그아웃 등)
 *
 * 검색은 label + keywords + group + section 모두에 대해 fuzzy.
 * 동적 검색(예약/고객/상품)은 search-providers.ts 가 담당.
 */

import type { LucideIcon } from 'lucide-react';

export type CommandKind = 'navigate' | 'action' | 'dynamic';

export interface AdminCommand {
  id: string;
  kind: CommandKind;
  label: string;
  /** 부가 설명 (예: 단축키, 상태) */
  hint?: string;
  /** 검색 시 매칭에 도움되는 추가 키워드 */
  keywords?: string[];
  /** 그룹화 (사이드바 그룹과 일치) */
  group: string;
  icon?: LucideIcon;
  /** kind='navigate' 일 때만 */
  href?: string;
  /** kind='action' 일 때만 */
  shortcut?: string;
  /** 단축키 시퀀스 (예: ['g', 'b']) */
  keySequence?: string[];
}
