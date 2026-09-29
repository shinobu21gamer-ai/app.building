#
# Push local environment values to a linked Vercel project.
#
# The Firebase service account must travel as FIREBASE_SERVICE_ACCOUNT (inline
# JSON) because Vercel has no filesystem for FIREBASE_SERVICE_ACCOUNT_PATH.
#
# Usage:
#   npx vercel link                      # one-time: pick/confirm the project
#   powershell -ExecutionPolicy Bypass -File scripts\vercel-env.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\vercel-env.ps1 -Environment production

param(
    [ValidateSet('preview', 'production', 'all')]
    [string]$Environment = 'production'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot '.env'

if (-not (Test-Path $EnvFile)) { throw ".env not found at $EnvFile" }
if (-not (Test-Path (Join-Path $ProjectRoot '.vercel'))) {
    throw 'No .vercel directory. Run: npx vercel link'
}

function Read-DotEnv([string]$Path) {
    $values = @{}
    foreach ($line in Get-Content $Path) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $key = ($line -split '=', 2)[0].Trim()
        $value = ($line -split '=', 2)[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($key) { $values[$key] = $value }
    }
    return $values
}

$envValues = Read-DotEnv $EnvFile

# Local-only values that must not be forwarded.
$skip = @('DATABASE_URL', 'FIREBASE_SERVICE_ACCOUNT_PATH', 'UPLOAD_DIR')

$serviceAccountPath = $envValues['FIREBASE_SERVICE_ACCOUNT_PATH']
if ($serviceAccountPath -and (Test-Path $serviceAccountPath)) {
    $json = Get-Content $serviceAccountPath -Raw
    # Collapse to a single line: Vercel env values must not contain newlines.
    $envValues['FIREBASE_SERVICE_ACCOUNT'] = ($json -replace '\r?\n', '')
    Write-Host '[env] loaded Firebase service account as inline JSON' -ForegroundColor Green
} elseif (-not $envValues['FIREBASE_SERVICE_ACCOUNT']) {
    Write-Warning 'No Firebase service account found; FCM push will be disabled on Vercel.'
}

$targets = if ($Environment -eq 'all') { @('preview', 'production') } else { @($Environment) }

foreach ($target in $targets) {
    foreach ($key in $envValues.Keys) {
        if ($skip -contains $key) { continue }
        if ([string]::IsNullOrWhiteSpace($envValues[$key])) { continue }
        Write-Host "[env] $target <- $key"
        npx.cmd vercel env add $key $target --force 2>&1 | Out-Null
    }
}

Write-Host ''
Write-Host 'Skipped (must be set manually on Vercel):' -ForegroundColor Yellow
Write-Host '  DATABASE_URL  -> the pooled Postgres URL from Neon'
Write-Host ''
Write-Host 'Then deploy with: npx vercel --prod' -ForegroundColor Green
