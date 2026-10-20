# One Click Answers backup: a zip of the project folder (with its git history) and a zip of the PRODUCTION Cloudflare KV data that is not in git, both to Z:\Backup\Websites\OCA\Backup.
# Read-only against the project and against Cloudflare. Writes only new timestamped files in the backup folder, then prunes ITS OWN older backups (keeps the newest $Keep of each kind).
# No password, token or secret is read, printed or stored by this script. The KV export deliberately leaves out the admin and visitor password hashes and the signing secrets.
param([int]$Keep = 30)
$ErrorActionPreference = 'Stop'
# Everything this script prints, and any error, is also appended to backup.log (a Windows scheduled run has no screen).
try { Start-Transcript -Path 'Z:\Backup\Websites\OCA\Backup\backup.log' -Append | Out-Null } catch { }
try {

$repo      = 'Z:\Backup\websites\OneClickAnswers'
$outDir    = 'Z:\Backup\Websites\OCA\Backup'
$prodKv    = '635ccc789cbb420c8a7512aab65ab037'   # production namespace id from wrangler.jsonc
$wrangler  = 'wrangler@4.149.0'
$stamp     = Get-Date -Format 'yyyyMMddHHmm'
# Optional off-machine copy: set the USER environment variable OCA_BACKUP_OFFSITE_DIR to a folder that a cloud service syncs (OneDrive, Dropbox, Google Drive ...).
# Optional failure email: set the USER environment variable OCA_SMTP_PASSWORD to the same Gmail App Password the GitHub secret OCA_SMTP_PASSWORD holds. Neither is stored in the repository.
$offsite   = $env:OCA_BACKUP_OFFSITE_DIR
$problems  = @()
function Invoke-Retry([scriptblock]$Do, [int]$Tries = 3) {
  for ($i = 1; $i -le $Tries; $i++) {
    $r = & $Do
    if ($r) { return $r }
    if ($i -lt $Tries) { Start-Sleep -Seconds (5 * $i * $i) }
  }
  return $null
}
function Send-Alert([string]$subject, [string]$body) {
  # Always leave a visible marker next to the backups, even when email is not set up.
  try { Set-Content -LiteralPath (Join-Path $outDir 'BACKUP-FAILED.txt') -Value "$subject`n$body`n$(Get-Date -Format o)" -Encoding UTF8 } catch { }
  if (-not $env:OCA_SMTP_PASSWORD) { Write-Output 'ALERT    email not sent: the user environment variable OCA_SMTP_PASSWORD is not set.'; return }
  try {
    $c = New-Object System.Net.Mail.SmtpClient('smtp.gmail.com', 587)
    $c.EnableSsl = $true
    $c.Credentials = New-Object System.Net.NetworkCredential('alvin@businesswebexpress.net', ($env:OCA_SMTP_PASSWORD -replace '\s', ''))
    $c.Send('contact@oneclickanswers.com', 'contact@oneclickanswers.com', $subject, $body)
    Write-Output 'ALERT    failure email sent.'
  } catch { Write-Output ("ALERT    email could not be sent: " + $_.Exception.Message) }
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
# A Windows scheduled run starts in C:\Windows\System32, where Wrangler cannot write its logs ("permission error accessing the file system"), so work from the project folder.
Set-Location -LiteralPath $repo

# ---------- 1. project zip (source, docs, tests, git history; NOT the folders that are rebuilt or hold secrets) ----------
$skipDirs  = @('node_modules', 'dist', '.astro', '.wrangler', '.tmp', 'test-results', 'playwright-report', 'shots')
$skipFiles = @('.dev.vars')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipFile = Join-Path $outDir "${stamp}OCA.zip"
if (Test-Path -LiteralPath $zipFile) { Remove-Item -LiteralPath $zipFile -Force }
$zip = [System.IO.Compression.ZipFile]::Open($zipFile, [System.IO.Compression.ZipArchiveMode]::Create)
$script:files = 0
function Add-Folder([string]$dir) {
  foreach ($f in Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue) {
    if ($skipFiles -contains $f.Name -or $f.Name -like '.env*') { continue }
    $rel = $f.FullName.Substring($repo.Length + 1).Replace('\', '/')   # zip entry names use forward slashes, so any unzip tool restores the folders
    try { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null; $script:files++ }
    catch { Write-Warning "skipped (locked or changing): $rel" }
  }
  foreach ($d in Get-ChildItem -LiteralPath $dir -Directory -Force -ErrorAction SilentlyContinue) {
    if ($skipDirs -contains $d.Name) { continue }
    Add-Folder $d.FullName
  }
}
try { Add-Folder $repo } finally { $zip.Dispose() }
$z = Get-Item -LiteralPath $zipFile
"PROJECT  $($z.FullName)  $([math]::Round($z.Length / 1MB, 1)) MB  $($script:files) files"
if ($script:files -lt 100) { throw "The project zip has only $($script:files) files: something is wrong." }

# ---------- 2. production KV data (business details, logo, favicon, settings, requests) ----------
$work = Join-Path $env:TEMP "oca-kv-$stamp"
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  $keys = Invoke-Retry { $j = & npx $wrangler kv key list --namespace-id $prodKv --remote 2>$null | Out-String; $k = @((ConvertFrom-Json $j) | ForEach-Object { $_.name }); if ($k.Count -gt 0) { , $k } else { $null } }
  if (-not $keys -or $keys.Count -eq 0) { throw 'The production KV list came back empty after 3 tries (Cloudflare API error?).' }
  # Left out on purpose: password hashes, signing secrets, one-time reset tokens, rate-limit counters and the cached crawler ranges (rebuilt automatically).
  $leave = '^(cred:|secret:|reset:|rl:|crawler-ranges$|site-accounts$)'
  $saved = @(); $left = @()
  foreach ($k in $keys) {
    if ($k -match $leave) { $left += $k; continue }
    $safe = ($k -replace '[^A-Za-z0-9._-]', '_')
    $dest = Join-Path $work $safe
    # cmd redirection keeps binary values (the logo and favicon images) byte for byte; PowerShell's own pipeline would re-encode them.
    $ok = Invoke-Retry { cmd /c "npx $wrangler kv key get `"$k`" --namespace-id $prodKv --remote > `"$dest`" 2>nul"; if ((Test-Path -LiteralPath $dest) -and (Get-Item -LiteralPath $dest).Length -gt 0) { $true } else { $null } }
    if ($ok) { $saved += $k } else { Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue; $left += "$k (empty or unreadable)"; $problems += "KV key not saved after 3 tries: $k" }
  }
  @{ takenAt = (Get-Date).ToString('o'); namespace = 'production'; saved = $saved; leftOut = $left } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $work '_manifest.json') -Encoding UTF8
  $kvZip = Join-Path $outDir "${stamp}OCA-kv.zip"
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $kvZip -Force
  $k2 = Get-Item -LiteralPath $kvZip
  "KV DATA  $($k2.FullName)  $($k2.Length) bytes  saved $($saved.Count) key(s); left out $($left.Count) (credentials, secrets, tokens, caches)"
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------- 2b. off-machine copy of the two zips just made ----------
if ($offsite) {
  try {
    New-Item -ItemType Directory -Force -Path $offsite | Out-Null
    Copy-Item -LiteralPath $zipFile, $kvZip -Destination $offsite -Force
    "OFFSITE  copied both zips to $offsite"
    foreach ($pattern in @('????????????OCA.zip', '????????????OCA-kv.zip')) {
      Get-ChildItem -LiteralPath $offsite -Filter $pattern -File | Sort-Object Name -Descending | Select-Object -Skip $Keep | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    }
  } catch { $problems += "Off-machine copy failed: $($_.Exception.Message)" }
} else { 'OFFSITE  not configured (set OCA_BACKUP_OFFSITE_DIR to a cloud-synced folder).' }

# ---------- 3. keep the newest $Keep of each kind (only files this script makes) ----------
foreach ($pattern in @('????????????OCA.zip', '????????????OCA-kv.zip')) {
  $old = Get-ChildItem -LiteralPath $outDir -Filter $pattern -File | Sort-Object Name -Descending | Select-Object -Skip $Keep
  foreach ($o in $old) { Remove-Item -LiteralPath $o.FullName -Force; "PRUNED   $($o.Name)" }
}
if ($problems.Count -gt 0) { throw ('Backup finished with problems: ' + ($problems -join '; ')) }
Remove-Item -LiteralPath (Join-Path $outDir 'BACKUP-FAILED.txt') -Force -ErrorAction SilentlyContinue
'DONE'
} catch {
  Write-Output ("FAILED: " + $_.Exception.Message)
  Send-Alert 'OCA BACKUP FAILED' ("The nightly OCA backup reported: " + $_.Exception.Message + "`nLog: Z:\Backup\Websites\OCA\Backup\backup.log")
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
try { Stop-Transcript | Out-Null } catch { }
