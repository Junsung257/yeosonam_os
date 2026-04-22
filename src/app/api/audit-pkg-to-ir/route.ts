/**
 * @file /api/audit-pkg-to-ir — Phase 1.5-γ 역변환 감사 헬퍼 API
 *
 * POST { pkg: PkgLike } → { ok, validated, warnings, errors, ir? }
 *
 * 용도: db/audit_legacy_pkg_to_ir.js 가 여러 pkg 를 배치로 감사할 때 TS 런타임 대신 API 호출.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pkgToIntake } from '@/lib/pkg-to-ir';
import { validateIntake } from '@/lib/intake-normalizer';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { pkg?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.pkg) {
    return NextResponse.json({ ok: false, error: 'pkg 필수' }, { status: 400 });
  }

  const { ir, warnings } = pkgToIntake(body.pkg as Parameters<typeof pkgToIntake>[0]);
  const validation = validateIntake(ir);

  if (validation.success) {
    return NextResponse.json({ ok: true, validated: true, warnings, errors: [] });
  }
  return NextResponse.json({
    ok: true,
    validated: false,
    warnings,
    errors: validation.errors?.map((e) => `[${e.path.join('.')}] ${e.message}`) || [],
  });
}
