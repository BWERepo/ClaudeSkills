# One-time per machine: makes bwe-skills available in EVERY local project (user scope). Safe to re-run.
# Usage: pwsh scripts/install.ps1            (or paste the 3 claude commands below into any terminal)
$ErrorActionPreference = 'Stop'
claude plugin marketplace add BWERepo/ClaudeSkills 2>$null   # ok if already added
claude plugin marketplace update bwe-skills
claude plugin install bwe-skills@bwe-skills --scope user
claude plugin update bwe-skills@bwe-skills --scope user
$p = (claude plugin list --json | ConvertFrom-Json) | Where-Object { $_.id -eq 'bwe-skills@bwe-skills' -and $_.scope -eq 'user' }
if (-not $p) { throw 'VERIFY FAILED: bwe-skills not installed at user scope.' }
Write-Host "VERIFIED: bwe-skills $($p.version) at user scope. Restart open Claude sessions to load it."
