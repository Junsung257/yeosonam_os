import { RiskLevel } from './types'

// HITL이 필요한 Tool 목록 (INSERT/UPDATE/DELETE)
export const HITL_TOOLS: Record<string, { riskLevel: RiskLevel; description: string }> = {
  // 운영
  create_booking:         { riskLevel: 'medium', description: '예약을 새로 생성합니다' },
  update_booking_status:  { riskLevel: 'medium', description: '예약 상태를 변경합니다' },
  create_customer:        { riskLevel: 'low',    description: '고객을 새로 등록합니다' },
  update_customer:        { riskLevel: 'low',    description: '고객 정보를 수정합니다' },
  match_payment:          { riskLevel: 'medium', description: '입금을 예약에 매칭합니다' },
  send_booking_guide:     { riskLevel: 'low',    description: '예약 안내문을 발송합니다' },
  // 상품
  update_package_status:  { riskLevel: 'medium', description: '패키지 상태를 변경합니다' },
  // 재무
  create_settlement:      { riskLevel: 'high',   description: '정산을 실행합니다' },
  // 영업
  update_rfq_status:      { riskLevel: 'medium', description: 'RFQ 상태를 변경합니다' },
  // 시스템
  update_policy:          { riskLevel: 'high',   description: '비즈니스 정책을 수정합니다' },
  // 감사 공백 채우기 (Phase 7)
  propose_blog_draft:         { riskLevel: 'low',    description: '블로그 초안을 기안합니다 (agent_actions 기록)' },
  propose_product_registration:{ riskLevel: 'medium', description: '신규 상품 등록을 기안합니다 (/register 파이프라인으로 승격 전 단계)' },
  propose_merge_customers:    { riskLevel: 'medium', description: '고객 병합 기안서를 제출합니다' },
}

export function requiresHITL(toolName: string): boolean {
  return toolName in HITL_TOOLS
}

export function getHITLInfo(toolName: string) {
  return HITL_TOOLS[toolName] ?? null
}

export function getRiskColor(level: RiskLevel): string {
  return { low: 'green', medium: 'amber', high: 'red' }[level]
}
