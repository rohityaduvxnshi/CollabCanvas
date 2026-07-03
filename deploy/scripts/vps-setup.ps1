# One-time VPS setup: finish PostgreSQL, create app role/db, firewall, cleanup.
# Run on the VPS as Administrator:
#   powershell -ExecutionPolicy Bypass -File vps-setup.ps1 -PgPassword <superuser-pw> -AppDbPassword <app-pw>
param(
  [Parameter(Mandatory)] [string]$PgPassword,
  [Parameter(Mandatory)] [string]$AppDbPassword
)
$ErrorActionPreference = 'Stop'
$pgBin  = 'C:\Program Files\PostgreSQL\17\bin'
$pgData = 'C:\Program Files\PostgreSQL\17\data'
$svcName = 'postgresql-x64-17'

# --- 1. Finish the interrupted installer deterministically -------------------
$svc = Get-Service $svcName -ErrorAction SilentlyContinue
if (-not $svc) {
  if (-not (Test-Path "$pgData\PG_VERSION")) {
    Write-Host "initdb: creating cluster at $pgData"
    $pwfile = "$env:TEMP\pgpw.txt"
    Set-Content -Path $pwfile -Value $PgPassword -Encoding ascii -NoNewline
    & "$pgBin\initdb.exe" -D $pgData -U postgres --pwfile $pwfile -E UTF8 -A scram-sha-256
    if ($LASTEXITCODE -ne 0) { throw "initdb failed ($LASTEXITCODE)" }
    Remove-Item $pwfile -Force
  }
  # postgres.exe refuses admin tokens — run the service as NetworkService.
  icacls $pgData /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T | Out-Null
  & "$pgBin\pg_ctl.exe" register -N $svcName -U 'NT AUTHORITY\NetworkService' -D $pgData -S auto
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl register failed ($LASTEXITCODE)" }
}
Start-Service $svcName
(Get-Service $svcName).Status

# --- 2. App role + database (idempotent) -------------------------------------
$env:PGPASSWORD = $PgPassword
$roleExists = & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='collabcanvas'"
if ($roleExists -ne '1') {
  & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "CREATE ROLE collabcanvas LOGIN PASSWORD '$AppDbPassword'"
}
$dbExists = & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname='collabcanvas'"
if ($dbExists -ne '1') {
  & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -c "CREATE DATABASE collabcanvas OWNER collabcanvas"
}
Remove-Item Env:\PGPASSWORD

# --- 3. Windows firewall: only Caddy's ports are public ----------------------
foreach ($p in 80, 443) {
  if (-not (Get-NetFirewallRule -DisplayName "Caddy TCP $p" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Caddy TCP $p" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null
  }
}

# --- 4. Clean install leftovers ----------------------------------------------
schtasks /delete /tn pginstall /f 2>$null
Remove-Item C:\pg-setup.exe, C:\node-setup.msi -Force -ErrorAction SilentlyContinue

# --- 5. Directory layout -------------------------------------------------------
foreach ($d in 'C:\apps', 'C:\apps\caddy', 'C:\apps\caddy\sites', 'C:\apps\winsw', 'C:\apps\logs') {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Write-Host 'vps-setup complete.'
