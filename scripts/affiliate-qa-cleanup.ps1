$ErrorActionPreference = 'Stop'
$sql = @'
BEGIN;
DELETE FROM public.affiliate_touchpoints WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_funnel_events WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_publication_commands WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_publications WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_saved_products WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_collection_products WHERE collection_id IN (SELECT id FROM public.affiliate_collections WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid);
DELETE FROM public.affiliate_collections WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_channels WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_domains WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_sessions WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.affiliate_invitations WHERE affiliate_id = '00000000-0000-4000-8000-000000000810'::uuid;
DELETE FROM public.notification_outbox WHERE aggregate_id = '00000000-0000-4000-8000-000000000812'::uuid;
DELETE FROM public.travel_packages WHERE id = '00000000-0000-4000-8000-000000000811'::uuid;
DELETE FROM public.affiliates WHERE id = '00000000-0000-4000-8000-000000000810'::uuid;
COMMIT;
'@
$sqlPath = 'C:\Users\admin\AppData\Local\Temp\codex-affiliate-qa-cleanup.sql'
Set-Content -LiteralPath $sqlPath -Value $sql -NoNewline
try {
  npx supabase db query --linked --file $sqlPath
} finally {
  Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
}
Write-Output 'cleanup=PASS'
