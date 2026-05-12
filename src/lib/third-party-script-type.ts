/**
 * NEXT_PUBLIC_PARTYTOWN=1 일 때만 Partytown(웹 워커)로 서드파티 스크립트 격리.
 * 기본값은 꺼두고, 성능 검증 후 프로덕션에서만 켜는 것을 권장.
 */
export function thirdPartyScriptType(): 'text/partytown' | undefined {
  return process.env.NEXT_PUBLIC_PARTYTOWN === '1' ? 'text/partytown' : undefined;
}
