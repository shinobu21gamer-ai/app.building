<#
  BarangayResolve dev host.

  Keeps the production server (port 3000) and a Cloudflare quick tunnel alive,
  and writes the current public URL to dev-url.txt so tooling and the phone app
  can pick it up without a rebuild.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\dev-host.ps1
  Stop with Ctrl+C, or kill the process running this script.
#>

$ErrorActionPreference = 'Continue'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $env:TEMP 'opencode'
$UrlFile = Join-Path $ProjectRoot 'dev-url.txt'
$ServerLog = Join-Path $LogDir 'bq-server.log'
$TunnelLog = Join-Path $LogDir 'bq-tunnel.log'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
}
if (-not $cloudflared -or -not (Test-Path $cloudflared)) {
    Write-Host 'cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/downloads-net/' -ForegroundColor Red
    exit 1
}

function Test-Port([int]$Port) {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-ForPort([int]$Port, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Port $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Start-AppServer {
    if (Test-Port 3000) {
        Write-Host '[host] server already listening on 3000'
        return
    }
    Write-Host '[host] starting next start on :3000'
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "npx next start -p 3000 > `"$ServerLog`" 2>&1" `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
    if (Wait-ForPort 3000 90) {
        Write-Host '[host] server ready'
    } else {
        Write-Host "[host] server did not start; see $ServerLog" -ForegroundColor Red
    }
}

function Get-TunnelUrl([string]$LogPath) {
    # cloudflared writes the assigned hostname to STDERR, not stdout, so both
    # streams have to be inspected or the URL is never discovered.
    $errPath = "$LogPath.err"
    for ($i = 0; $i -lt 30; $i++) {
        $hit = Select-String -Path @($LogPath, $errPath) -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
            Select-Object -Last 1
        if ($hit) {
            return ([regex]::Match($hit.Line, 'https://[a-z0-9-]+\.trycloudflare\.com')).Value
        }
        Start-Sleep -Seconds 1
    }
    return $null
}

function Set-UrlFile([string]$Url) {
    if (-not $Url) { return }
    Set-Content -Path $UrlFile -Value $Url -Encoding ascii
    Write-Host "[host] public URL: $Url" -ForegroundColor Green
}

function Test-TunnelRunning {
    return $null -ne (Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
        Where-Object { $_.CommandLine -like '*localhost:3000*' })
}

function Start-Tunnel {
    if (Test-TunnelRunning) {
        Write-Host '[host] tunnel already running; resolving current URL'
        Set-UrlFile (Get-TunnelUrl $TunnelLog)
        return
    }
    Write-Host '[host] starting cloudflared quick tunnel'
    Remove-Item $TunnelLog, "$TunnelLog.err" -ErrorAction SilentlyContinue
    Start-Process -FilePath $cloudflared `
        -ArgumentList 'tunnel', '--url', 'http://localhost:3000', '--no-autoupdate' `
        -WindowStyle Hidden `
        -RedirectStandardOutput $TunnelLog `
        -RedirectStandardError "$TunnelLog.err" | Out-Null

    Set-UrlFile (Get-TunnelUrl $TunnelLog)
}

Start-AppServer
Start-Tunnel

Write-Host ''
Write-Host '  Watching. The URL is rewritten to dev-url.txt whenever the tunnel restarts.'
Write-Host '  Update .env (NEXT_PUBLIC_APP_URL) and capacitor.config.ts after a URL change,'
Write-Host '  then rebuild: npx next build && npx cap sync android && gradlew assembleDebug'
Write-Host '  Press Ctrl+C to stop.'
Write-Host ''

$lastUrl = Get-Content $UrlFile -ErrorAction SilentlyContinue
while ($true) {
    Start-Sleep -Seconds 15

    if (-not (Test-Port 3000)) {
        Write-Host '[host] server died; restarting'
        Start-AppServer
    }

    $running = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
        Where-Object { $_.CommandLine -like '*localhost:3000*' }

    if (-not $running) {
        Write-Host '[host] tunnel died; restarting (URL WILL CHANGE)'
        Start-Tunnel
        $lastUrl = Get-Content $UrlFile -ErrorAction SilentlyContinue
        continue
    }

    $url = Get-Content $UrlFile -ErrorAction SilentlyContinue
    if ($url -and $url -ne $lastUrl) {
        Write-Host "[host] URL changed to $url" -ForegroundColor Yellow
        $lastUrl = $url
    }
}