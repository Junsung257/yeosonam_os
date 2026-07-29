import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCronBearer: vi.fn(),
  runAgentHousekeeping: vi.fn(),
}))

vi.mock('@/lib/cron-auth', () => ({
  requireCronBearer: mocks.requireCronBearer,
}))

vi.mock('@/lib/agent/housekeeping', () => ({
  runAgentHousekeeping: mocks.runAgentHousekeeping,
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseAdminConfigured: true,
}))

import { GET } from './route'

describe('agent housekeeping cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCronBearer.mockReturnValue(null)
  })

  it('returns the cron authentication response without touching housekeeping', async () => {
    const unauthorized = new NextResponse(null, { status: 401 })
    mocks.requireCronBearer.mockReturnValue(unauthorized)

    const response = await GET(
      new NextRequest('http://localhost/api/cron/agent-housekeeping'),
    )

    expect(response).toBe(unauthorized)
    expect(mocks.runAgentHousekeeping).not.toHaveBeenCalled()
  })

  it('runs only bounded housekeeping and returns its counts', async () => {
    mocks.runAgentHousekeeping.mockResolvedValue({
      scanned: { approvals: 3, tasks: 5, traces: 7 },
      expired: { approvals: 1, tasks: 2, traces: 4 },
    })

    const response = await GET(
      new NextRequest('http://localhost/api/cron/agent-housekeeping'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.runAgentHousekeeping).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({
      ok: true,
      scanned: { approvals: 3, tasks: 5, traces: 7 },
      expired: { approvals: 1, tasks: 2, traces: 4 },
    })
    expect(body.elapsed_ms).toEqual(expect.any(Number))
  })

  it('returns a generic error when housekeeping fails', async () => {
    mocks.runAgentHousekeeping.mockRejectedValue(new Error('database detail'))

    const response = await GET(
      new NextRequest('http://localhost/api/cron/agent-housekeeping'),
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'AGENT_HOUSEKEEPING_FAILED',
        message: 'Agent housekeeping failed',
      },
    })
  })

  it('is registered as a native Vercel cron with the safe operator command', () => {
    const root = process.cwd()
    const vercelConfig = JSON.parse(
      readFileSync(join(root, 'vercel.json'), 'utf8'),
    )
    const packageJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    )

    expect(vercelConfig.crons).toContainEqual({
      path: '/api/cron/agent-housekeeping',
      schedule: '7 0 * * *',
    })
    expect(packageJson.scripts['agent:housekeeping:production']).toBe(
      'vercel crons run /api/cron/agent-housekeeping',
    )
  })
})
