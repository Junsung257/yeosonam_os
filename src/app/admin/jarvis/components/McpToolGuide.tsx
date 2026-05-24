'use client'
import { useState } from 'react'
import { ChevronRight, ChevronLeft, Search, BarChart3, TrendingUp, DollarSign, Newspaper, Sparkle, Megaphone, BookOpen, FolderKanban, Bell, FileText, GraduationCap, LucideIcon } from 'lucide-react'

interface ToolItem {
  name: string
  description: string
  icon: LucideIcon
  example?: string
}

interface ToolGroup {
  title: string
  icon: LucideIcon
  tools: ToolItem[]
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    title: '키워드/광고',
    icon: Search,
    tools: [
      { name: 'get_keyword_stats', description: '키워드 성과 통계', icon: BarChart3, example: '"키워드 성과 알려줘"' },
      { name: 'get_ad_performance', description: '광고 성과 (ROAS/클릭/전환)', icon: TrendingUp, example: '"광고 성과 어때?"' },
      { name: 'get_ad_budget_summary', description: '광고비 지출 요약', icon: DollarSign, example: '"광고비 얼마 썼어?"' },
      { name: 'get_optimization_logs', description: '최적화 실행 로그', icon: BarChart3, example: '"최적화 잘 되고 있어?"' },
      { name: 'run_ad_optimization', description: '광고 최적화 실행 (HITL)', icon: TrendingUp, example: '"최적화 한번 돌려줘"' },
      { name: 'list_campaigns', description: '캠페인 목록 조회', icon: Megaphone, example: '"캠페인 뭐 있어?"' },
    ],
  },
  {
    title: '콘텐츠',
    icon: FileText,
    tools: [
      { name: 'generate_card_news', description: '카드뉴스 자동 생성', icon: Newspaper, example: '"카드뉴스 만들어줘"' },
      { name: 'generate_sns_copy', description: 'SNS 카피 생성', icon: Sparkle, example: '"인스타 카피 만들어줘"' },
      { name: 'get_content_performance_summary', description: '콘텐츠 전체 성과', icon: BarChart3, example: '"콘텐츠 성과 종합"' },
      { name: 'propose_blog_draft', description: '블로그 초안 기안', icon: BookOpen, example: '"블로그 글 써줘"' },
      { name: 'list_blog_posts', description: '블로그 게시글 조회', icon: BookOpen, example: '"블로그 상황 알려줘"' },
      { name: 'list_content_hub_items', description: '콘텐츠 허브 조회', icon: FolderKanban, example: '"콘텐츠 뭐 있어?"' },
    ],
  },
  {
    title: '알림/시스템',
    icon: Bell,
    tools: [
      { name: 'list_admin_alerts_marketing', description: '마케팅 알림 조회', icon: Bell, example: '"알림 뭐 있어?"' },
      { name: 'list_content_queue', description: '콘텐츠 검수 큐 조회', icon: FileText, example: '"검수할 거 있어?"' },
    ],
  },
]

const MCP_TOOL_COUNT = TOOL_GROUPS.reduce((acc, g) => acc + g.tools.length, 0)

export default function McpToolGuide() {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className={`border-l border-admin-border-mid bg-admin-surface/50 transition-all duration-200 ${collapsed ? 'w-10' : 'w-72'}`}>
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="w-10 h-full flex items-center justify-center hover:bg-admin-surface-hover transition-colors"
          title="도구 목록 열기"
        >
          <div className="flex flex-col items-center gap-1">
            <GraduationCap className="w-4 h-4 text-brand" />
            <span className="text-[9px] text-brand font-medium">{MCP_TOOL_COUNT}</span>
            <ChevronLeft className="w-3 h-3 text-admin-muted" />
          </div>
        </button>
      ) : (
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-admin-border-mid bg-admin-surface">
            <div className="flex items-center gap-1.5">
              <GraduationCap className="w-4 h-4 text-brand" />
              <span className="text-[13px] font-semibold text-admin-text">MCP 도구</span>
              <span className="text-[10px] text-admin-muted-2">({MCP_TOOL_COUNT}개)</span>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="text-admin-muted hover:text-admin-text transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 space-y-3">
            {TOOL_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="flex items-center gap-1.5 mb-1.5 px-1">
                  <group.icon className="w-3.5 h-3.5 text-admin-muted" />
                  <span className="text-[11px] font-medium text-admin-muted uppercase tracking-wider">{group.title}</span>
                </div>
                <div className="space-y-1">
                  {group.tools.map((tool) => (
                    <div
                      key={tool.name}
                      className="group relative px-2 py-1.5 rounded-md hover:bg-admin-surface-hover cursor-default transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <tool.icon className="w-3 h-3 text-brand shrink-0" />
                        <span className="text-[12px] text-admin-text-2 truncate">{tool.description}</span>
                      </div>
                      {tool.example && (
                        <div className="hidden group-hover:block absolute left-0 top-full z-10 mt-0.5 px-2 py-1 bg-admin-surface border border-admin-border rounded-md shadow-md text-[11px] text-brand whitespace-nowrap">
                          {tool.example}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="pt-2 border-t border-admin-border-mid">
              <p className="text-[10px] text-admin-muted-2 px-1 leading-relaxed">
                자비스에게 자연어로 명령하면 AI가 적절한 도구를 선택해 실행합니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
