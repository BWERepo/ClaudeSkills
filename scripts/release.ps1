# Releases the bwe-skills plugin from this repo and proves the result is visible to Claude Code.
# Run from anywhere:  pwsh scripts/release.ps1 -Message "Added BWE-FOO skill"
# Steps: next version (yyyy.mm.dd.nn) -> plugin.json -> CHANGELOG -> catalog + validate -> commit -> tag -> push -> update local plugin -> verify.
# Use -SkipGit to only update the version files and validate (no commit, tag or push).
param(
  [Parameter(Mandatory = $true)][string]$Message,
  [switch]$SkipGit
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Run($cmd) { Write-Host "> $cmd"; Invoke-Expression $cmd; if ($LASTEXITCODE -ne 0) { throw "Failed: $cmd" } }

if (-not $SkipGit) {
  if ((git branch --show-current) -ne 'main') { throw 'Release from main (merge your PR first, then git pull).' }
  Run 'git fetch -q'
  if (git status --porcelain) { Write-Host 'Note: working tree has uncommitted changes; they will be included in the release commit.' }
  if ((git rev-list --count HEAD..origin/main) -gt 0) { throw 'Local main is behind origin/main. Run git pull first.' }
}

$pluginPath = '.claude-plugin/plugin.json'
$plugin = Get-Content $pluginPath -Raw | ConvertFrom-Json
$today = Get-Date -Format 'yyyy.MM.dd'
$seq = 1
if ($plugin.version -like "$today.*") { $seq = [int]($plugin.version.Split('.')[3]) + 1 }
$version = '{0}.{1:00}' -f $today, $seq

$noBom = New-Object System.Text.UTF8Encoding($false)
$root = (Get-Location).Path
[IO.File]::WriteAllText("$root/$pluginPath", ((Get-Content $pluginPath -Raw) -replace '"version":\s*"[^"]+"', "`"version`": `"$version`""), $noBom)
$entry = "## [$version] - $(Get-Date -Format 'yyyy-MM-dd')`n- $Message`n"
$log = Get-Content CHANGELOG.md -Raw
$log = $log -replace '^# Changelog\r?\n', "# Changelog`n$entry"
[IO.File]::WriteAllText("$root/CHANGELOG.md", $log, $noBom)

Run 'python scripts/catalog.py'
$bash = (Get-Command bash -ErrorAction SilentlyContinue).Source
if (-not $bash) {
  $gitRoot = Split-Path (Split-Path (Get-Command git).Source)
  $bash = @("$gitRoot\bin\bash.exe", "$gitRoot\usr\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $bash) { throw 'bash not found (needed for scripts/validate.sh); install Git for Windows.' }
Run "& '$bash' scripts/validate.sh"

if ($SkipGit) { Write-Host "Version files set to $version (no git). Done."; return }

Run 'git add -A'
Run "git commit -m `"Release $version`: $Message`""
Run "git tag v$version"
Run 'git push origin main'
Run "git push origin v$version"

# Update this machine and prove the new version is what Claude Code sees.
Run 'claude plugin marketplace update bwe-skills'
Run 'claude plugin update bwe-skills@bwe-skills --scope user'
$seen = (claude plugin list --json | ConvertFrom-Json) | Where-Object { $_.id -eq 'bwe-skills@bwe-skills' -and $_.scope -eq 'user' }
if ($seen.version -ne $version) { throw "VERIFY FAILED: Claude Code reports $($seen.version) at user scope, expected $version." }
$missing = Get-ChildItem skills -Directory | Where-Object { -not (Test-Path (Join-Path $seen.installPath "skills/$($_.Name)/SKILL.md")) }
if ($missing) { throw "VERIFY FAILED: installed copy lacks: $($missing.Name -join ', ')" }
Write-Host "VERIFIED: bwe-skills $version installed at user scope with all $((Get-ChildItem skills -Directory).Count) skills."
Write-Host 'Restart open Claude sessions (or start new ones) to load it.'
