[CmdletBinding()]
param(
  [string]$SourceRepository = (Get-Location).Path,
  [string]$GitHubOwner = "tidyups-booking",
  [string]$RepositoryPrefix = "Day",
  [string]$BackupRoot = "D:\AI-Receptionist-Backups",
  [switch]$Private
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & git -C $SourceRepository @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed."
  }
}

if (-not (Test-Path -LiteralPath "D:\")) {
  throw "D:\ is unavailable. No repository or backup was created."
}

if (-not (Test-Path -LiteralPath (Join-Path $SourceRepository ".git"))) {
  throw "SourceRepository is not a Git repository: $SourceRepository"
}

& gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated. Run 'gh auth login' first."
}

$dirty = Invoke-Git status --porcelain
if ($dirty) {
  throw "The source repository has uncommitted changes. Commit them before creating a daily start point."
}

$existingNames = @(
  & gh repo list $GitHubOwner --limit 1000 --json name --jq ".[].name"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list repositories for $GitHubOwner."
  }
)

$pattern = "^$([regex]::Escape($RepositoryPrefix))(\d+)_Build$"
$highest = 0
foreach ($name in $existingNames) {
  if ($name -match $pattern) {
    $highest = [Math]::Max($highest, [int]$Matches[1])
  }
}

$day = $highest + 1
$repositoryName = "${RepositoryPrefix}${day}_Build"
$githubRepository = "$GitHubOwner/$repositoryName"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDirectory = Join-Path $BackupRoot "$repositoryName-$timestamp"
$sourceSnapshot = Join-Path $backupDirectory "source"
$bundlePath = Join-Path $backupDirectory "$repositoryName.bundle"
$zipPath = Join-Path $backupDirectory "$repositoryName-source.zip"
$checksumPath = "$zipPath.sha256"
$temporaryRemote = "daily-build-$day"

New-Item -ItemType Directory -Path $sourceSnapshot -Force | Out-Null

# git archive writes directly to a ZIP on Windows, avoiding pipeline corruption.
$archivePath = Join-Path $backupDirectory "$repositoryName-source-snapshot.zip"
Invoke-Git archive --format=zip --output=$archivePath HEAD
Expand-Archive -LiteralPath $archivePath -DestinationPath $sourceSnapshot -Force
Remove-Item -LiteralPath $archivePath

Invoke-Git bundle create $bundlePath --all
& git bundle verify $bundlePath
if ($LASTEXITCODE -ne 0) {
  throw "Git bundle verification failed. No GitHub repository was created."
}

Compress-Archive -Path (Join-Path $sourceSnapshot "*") -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath $checksumPath -Encoding ascii
$recordedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split "\s+")[0]
$verifiedHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($recordedHash -ne $verifiedHash) {
  throw "ZIP checksum verification failed. No GitHub repository was created."
}

$visibility = if ($Private) { "--private" } else { "--public" }
& gh repo create $githubRepository $visibility --description "AI Receptionist daily build start point $day"
if ($LASTEXITCODE -ne 0) {
  throw "GitHub repository creation failed. The verified local backup remains at $backupDirectory."
}

try {
  Invoke-Git remote add $temporaryRemote "https://github.com/$githubRepository.git"
  Invoke-Git push $temporaryRemote "HEAD:main"
} finally {
  & git -C $SourceRepository remote remove $temporaryRemote 2>$null
}

[pscustomobject]@{
  Repository = "https://github.com/$githubRepository"
  Day = $day
  Commit = (Invoke-Git rev-parse HEAD)
  BackupDirectory = $backupDirectory
  SourceSnapshot = $sourceSnapshot
  Bundle = $bundlePath
  Zip = $zipPath
  Checksum = $checksumPath
  Sha256 = $hash
  BundleVerified = $true
  ChecksumVerified = $true
} | Format-List
