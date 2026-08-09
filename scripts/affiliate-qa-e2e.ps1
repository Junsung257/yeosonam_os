param(
  [string]$TokenPath = 'C:\Users\admin\AppData\Local\Temp\codex-affiliate-qa-token.txt'
)

$ErrorActionPreference = 'Stop'
$base = 'https://www.yeosonam.com'
$affiliateId = '00000000-0000-4000-8000-000000000810'
$productId = '00000000-0000-4000-8000-000000000811'
[string]$token = Get-Content -LiteralPath $TokenPath -Raw

function Read-JsonResponse($response) {
  return ($response.Content | ConvertFrom-Json)
}

function Write-Check([string]$Name, [bool]$Ok, [string]$Detail) {
  $state = if ($Ok) { 'PASS' } else { 'FAIL' }
  Write-Output "$Name=$state $Detail"
  if (-not $Ok) { throw "QA check failed: $Name" }
}

$activateBody = @{ token = $token; otp = '123456' } | ConvertTo-Json -Compress
$activation = Invoke-WebRequest -Uri "$base/api/partner/auth/activate" -Method Post `
  -Headers @{ Origin = $base; 'Content-Type' = 'application/json' } `
  -Body $activateBody -SessionVariable qaSession -UseBasicParsing
$activationJson = Read-JsonResponse $activation
Write-Check 'activation' ($activation.StatusCode -eq 200 -and $activationJson.authenticated -eq $true) "status=$($activation.StatusCode)"

$session = Invoke-WebRequest -Uri "$base/api/partner/auth/session" -Method Get -WebSession $qaSession -UseBasicParsing
$sessionJson = Read-JsonResponse $session
Write-Check 'session' ($session.StatusCode -eq 200 -and $sessionJson.authenticated -eq $true -and $sessionJson.affiliate.id -eq $affiliateId) "status=$($session.StatusCode)"

$catalog = Invoke-WebRequest -Uri "$base/api/partner/catalog?product_id=$productId" -Method Get -WebSession $qaSession -UseBasicParsing
$catalogJson = Read-JsonResponse $catalog
$sample = @($catalogJson.products) | Where-Object { $_.id -eq $productId } | Select-Object -First 1
Write-Check 'catalog' ($catalog.StatusCode -eq 200 -and $catalogJson.state -eq 'ready' -and $null -ne $sample -and $sample.availability.sellable -eq $true) "status=$($catalog.StatusCode) state=$($catalogJson.state)"

$publicationBody = @{
  product_id = $productId
  channel_type = 'BLOG'
  placement_name = 'Codex QA sample'
  sub_id = 'smoke'
} | ConvertTo-Json -Compress
$publication = Invoke-WebRequest -Uri "$base/api/partner/publications" -Method Post `
  -Headers @{ Origin = $base; 'Content-Type' = 'application/json'; 'Idempotency-Key' = 'codexqa:pub:0810' } `
  -Body $publicationBody -WebSession $qaSession -UseBasicParsing
$publicationJson = Read-JsonResponse $publication
$publicationId = [string]$publicationJson.publication.id
Write-Check 'publication_create' ($publication.StatusCode -eq 201 -and $publicationJson.publication.product_id -eq $productId -and $publicationJson.publication.status -eq 'DRAFT') "status=$($publication.StatusCode) publication_id=$publicationId"

$publicationReplay = Invoke-WebRequest -Uri "$base/api/partner/publications" -Method Post `
  -Headers @{ Origin = $base; 'Content-Type' = 'application/json'; 'Idempotency-Key' = 'codexqa:pub:0810' } `
  -Body $publicationBody -WebSession $qaSession -UseBasicParsing
$publicationReplayJson = Read-JsonResponse $publicationReplay
Write-Check 'publication_idempotency' ($publicationReplay.StatusCode -eq 200 -and $publicationReplayJson.idempotent_replay -eq $true -and $publicationReplayJson.publication.id -eq $publicationId) "status=$($publicationReplay.StatusCode)"

$publicationList = Invoke-WebRequest -Uri "$base/api/partner/publications" -Method Get -WebSession $qaSession -UseBasicParsing
$publicationListJson = Read-JsonResponse $publicationList
$listed = @($publicationListJson.publications) | Where-Object { $_.id -eq $publicationId } | Select-Object -First 1
Write-Check 'publication_list' ($publicationList.StatusCode -eq 200 -and $null -ne $listed -and $listed.short_url -like "*$publicationId") "status=$($publicationList.StatusCode)"

$goRequest = [System.Net.HttpWebRequest]::Create("$base/go/$publicationId")
$goRequest.AllowAutoRedirect = $false
$goResponse = $goRequest.GetResponse()
$goLocation = [string]$goResponse.Headers['Location']
Write-Check 'short_link' ([int]$goResponse.StatusCode -eq 302 -and $goLocation -like '*/api/influencer/track*publication=*') "status=$([int]$goResponse.StatusCode)"
$goResponse.Dispose()

$trackUrl = if ($goLocation -match '^https?://') { $goLocation } else { "$base$goLocation" }
$trackRequest = [System.Net.HttpWebRequest]::Create($trackUrl)
$trackRequest.AllowAutoRedirect = $false
$trackRequest.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
$trackRequest.Referer = "$base/partner/publications"
$trackResponse = $trackRequest.GetResponse()
$trackLocation = [string]$trackResponse.Headers['Location']
Write-Check 'tracking_redirect' ([int]$trackResponse.StatusCode -eq 302 -and $trackLocation -like "*/packages/$productId*") "status=$([int]$trackResponse.StatusCode) location=$trackLocation"
$trackResponse.Dispose()

$logout = Invoke-WebRequest -Uri "$base/api/partner/auth/session" -Method Delete `
  -Headers @{ Origin = $base } -WebSession $qaSession -UseBasicParsing
Write-Check 'logout' ($logout.StatusCode -eq 200) "status=$($logout.StatusCode)"

$afterLogout = $null
try {
  $afterLogout = Invoke-WebRequest -Uri "$base/api/partner/auth/session" -Method Get -WebSession $qaSession -UseBasicParsing
} catch {
  if ($_.Exception.Response) { $afterLogout = $_.Exception.Response } else { throw }
}
$afterLogoutStatus = [int]$afterLogout.StatusCode
Write-Check 'session_revoked' ($afterLogoutStatus -eq 401) "status=$afterLogoutStatus"

Write-Output "publication_id=$publicationId"
Write-Output "sample_affiliate_id=$affiliateId"
Write-Output "sample_product_id=$productId"
