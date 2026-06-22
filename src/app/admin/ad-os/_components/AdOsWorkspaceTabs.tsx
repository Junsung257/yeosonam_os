import type { ReactNode } from 'react';

export type AdOsWorkspaceTab = 'run' | 'settings' | 'report' | 'advanced';

export const AD_OS_WORKSPACE_TABS: Array<{
  id: AdOsWorkspaceTab;
  label: string;
  description: string;
}> = [
  { id: 'run', label: '바로 실행', description: '초보자가 볼 진단, 초안, 승인 요청' },
  { id: 'settings', label: '상세 설정', description: '예산, 채널, 정책, 계정 연결' },
  { id: 'report', label: '성과/리포트', description: 'ROAS, 검색어, 리포트, 변경 요청' },
  { id: 'advanced', label: '고급/감사', description: '개발자용 점검, 대기열, 원본 근거' },
];

export function parseAdOsWorkspaceTab(value: string | null): AdOsWorkspaceTab {
  return AD_OS_WORKSPACE_TABS.some((tab) => tab.id === value)
    ? value as AdOsWorkspaceTab
    : 'run';
}

export function AdOsWorkspaceTabs({
  activeTab,
  onTabChange,
  children,
}: {
  activeTab: AdOsWorkspaceTab;
  onTabChange: (tab: AdOsWorkspaceTab) => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="rounded-admin-md border border-admin-border bg-admin-surface p-2">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {AD_OS_WORKSPACE_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`rounded-admin-sm border px-3 py-2 text-left transition ${
                  active
                    ? 'border-slate-900 bg-slate-950 text-white'
                    : 'border-admin-border bg-admin-surface-2 text-admin-text hover:border-admin-border-strong'
                }`}
              >
                <span className="block text-admin-xs font-bold">{tab.label}</span>
                <span className={`mt-0.5 block text-admin-2xs ${active ? 'text-slate-200' : 'text-admin-muted'}`}>
                  {tab.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {children}
    </section>
  );
}
