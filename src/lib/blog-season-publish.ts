/**
 * 시즌성 토픽: 목표 여행 월(month 1~12) 기준 **약 D-60** 선행 발행 시각
 * (해당 월 1일 00:00 UTC 기준 60일 전; 이미 지났으면 내년 동월 기준)
 */

export function computeSeasonalTargetPublishAt(month: number | null | undefined): string | null {
  if (month == null || month < 1 || month > 12) return null

  const now = new Date()
  let year = now.getUTCFullYear()
  let travelMonthStart = new Date(Date.UTC(year, month - 1, 1, 6, 0, 0))
  if (travelMonthStart.getTime() <= now.getTime()) {
    year += 1
    travelMonthStart = new Date(Date.UTC(year, month - 1, 1, 6, 0, 0))
  }

  const publish = new Date(travelMonthStart)
  publish.setUTCDate(publish.getUTCDate() - 60)

  const min = new Date(now.getTime() + 60 * 60 * 1000)
  if (publish.getTime() < min.getTime()) return min.toISOString()
  return publish.toISOString()
}
