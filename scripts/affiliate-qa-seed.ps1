param(
  [string]$SupabaseWorkdir = 'C:\dev\yeosonam-os-affiliate-remediation'
)

$ErrorActionPreference = 'Stop'
$secretPath = 'C:\Users\admin\AppData\Local\Temp\codex-affiliate-auth-secret.txt'
$tokenPath = 'C:\Users\admin\AppData\Local\Temp\codex-affiliate-qa-token.txt'
$sqlPath = 'C:\Users\admin\AppData\Local\Temp\codex-affiliate-qa-seed.sql'

$affiliateId = '00000000-0000-4000-8000-000000000810'
$productId = '00000000-0000-4000-8000-000000000811'
$invitationId = '00000000-0000-4000-8000-000000000812'
$sourceProductId = 'fd7e3032-817c-4912-bc78-13563005d2db'
$referralCode = 'CODEXQA0810'
$phone = '010-9999-0000'
$email = 'codex-qa@example.invalid'
$otp = '123456'

function Get-Sha256Hex([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-HmacSha256Hex([byte[]]$Key, [string]$Value) {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($Key)
  try {
    return ([BitConverter]::ToString($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant()
  } finally { $hmac.Dispose() }
}

$secret = (Get-Content -LiteralPath $secretPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 32) { throw 'Affiliate auth secret is missing or too short.' }

$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
$rawToken = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
Set-Content -LiteralPath $tokenPath -Value $rawToken -NoNewline

$tokenHash = Get-Sha256Hex $rawToken
$recipientHash = Get-Sha256Hex $phone
$rootKey = [System.Text.Encoding]::UTF8.GetBytes($secret)
$derivedKey = [System.Security.Cryptography.HMACSHA256]::new($rootKey).ComputeHash([System.Text.Encoding]::UTF8.GetBytes('yeosonam-affiliate-otp-v1'))
$otpHash = Get-HmacSha256Hex $derivedKey ("$invitationId`:$otp")

$sql = @"
BEGIN;
DELETE FROM public.affiliate_touchpoints WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_funnel_events WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_publications WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_saved_products WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_collection_products WHERE collection_id IN (SELECT id FROM public.affiliate_collections WHERE affiliate_id = '$affiliateId'::uuid);
DELETE FROM public.affiliate_collections WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_channels WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_domains WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_sessions WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.affiliate_invitations WHERE affiliate_id = '$affiliateId'::uuid;
DELETE FROM public.notification_outbox WHERE aggregate_id = '$invitationId'::uuid;
DELETE FROM public.travel_packages WHERE id = '$productId'::uuid;
DELETE FROM public.affiliates WHERE id = '$affiliateId'::uuid;

INSERT INTO public.affiliates (
  id, name, phone, email, referral_code, grade, bonus_rate, payout_type,
  commission_rate, is_active, partner_status, token_version,
  payout_profile_status, tax_profile_status, onboarding_progress, memo
) VALUES (
  '$affiliateId'::uuid, 'Codex QA Affiliate', '$phone', '$email', '$referralCode', 1, 0,
  'PERSONAL', 0.02, true, 'approved_not_onboarded', 1,
  'NOT_SUBMITTED', 'NOT_SUBMITTED', '{}'::jsonb, 'codex affiliate E2E sample; delete after verification'
);

INSERT INTO public.travel_packages
SELECT (jsonb_populate_record(
  NULL::public.travel_packages,
  to_jsonb(src) || jsonb_build_object(
    'id', '$productId'::uuid,
    'title', 'CODEX QA SAMPLE - DELETE AFTER QA',
    'display_title', 'CODEX QA SAMPLE - DELETE AFTER QA',
    'short_code', 'CODEXQA0810',
    'internal_code', NULL,
    'status', 'active',
    'publication_state', 'published',
    'price', 100000,
    'cost_price', 50000,
    'commission_rate', 0.02,
    'affiliate_commission_rate', 0.02,
    'seats_confirmed', 1,
    'seats_held', 0,
    'seats_ticketed', 0,
    'confirmed_dates', '[{"departure_date":"2026-09-10"}]'::jsonb,
    'price_dates', '[{"date":"2026-09-10","price":100000,"confirmed":true}]'::jsonb,
    'audit_status', 'clean',
    'is_stub', false
  )
)).*
FROM public.travel_packages src
WHERE src.id = '$sourceProductId'::uuid;

INSERT INTO public.affiliate_invitations (
  id, affiliate_id, purpose, token_hash, recipient_hash, expires_at,
  otp_hash, otp_expires_at, otp_sent_at, created_by
) VALUES (
  '$invitationId'::uuid, '$affiliateId'::uuid, 'activation', '$tokenHash', '$recipientHash',
  now() + interval '30 minutes', '$otpHash', now() + interval '10 minutes', now(), 'codex-qa'
);

COMMIT;
"@

Set-Content -LiteralPath $sqlPath -Value $sql -NoNewline
Push-Location $SupabaseWorkdir
try {
  npx supabase db query --linked --file $sqlPath
} finally { Pop-Location }

Write-Output "affiliate_id=$affiliateId"
Write-Output "product_id=$productId"
Write-Output "invitation_id=$invitationId"
Write-Output "token_path=$tokenPath"
Write-Output "otp=123456"
