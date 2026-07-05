# Build + (re)start CollabCanvas on the VPS. Idempotent — run for every deploy.
# Expects: repo extracted at C:\apps\collabcanvas, env files already in place
# (web\.env.production, ws-server\.env — see deploy\env\*.example).
#   powershell -ExecutionPolicy Bypass -File vps-deploy.ps1
$ErrorActionPreference = 'Stop'
$repo = 'C:\apps\collabcanvas'
Set-Location $repo

# Prisma CLI needs DATABASE_URL; read it from the ws env file (same DB).
# The value may be QUOTED in the .env — dotenv/Next strip quotes at load, but
# the Prisma CLI does not, so leaving them throws P1013 "scheme not recognized".
# Strip surrounding quotes (and trim CR/space) before handing it to prisma.
$dbLine = (Select-String -Path "$repo\ws-server\.env" -Pattern '^DATABASE_URL=').Line
if (-not $dbLine) { throw 'DATABASE_URL missing from ws-server\.env' }
$env:DATABASE_URL = $dbLine.Substring(13).Trim().Trim('"').Trim("'")

# Stop services BEFORE npm ci — the running node/tsx holds locks on node_modules
# (Windows EPERM unlinking esbuild.exe). Graceful Stop-Service only: NO -Force —
# an ungraceful kill trips WinSW's onfailure=restart (5s) and bounces the service
# back mid-build, re-locking the files. The 8s settle lets that window pass.
$services = 'collabcanvas-ws', 'collabcanvas-web'
foreach ($s in $services) {
  if ((Get-Service $s -ErrorAction SilentlyContinue) -and (Get-Service $s).Status -ne 'Stopped') {
    Stop-Service $s; Write-Host "stopped $s"
  }
}
Start-Sleep -Seconds 8

Write-Host '=== npm ci ==='
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

Write-Host '=== prisma generate + db push ==='
npm run generate --workspace=packages/db
if ($LASTEXITCODE -ne 0) { throw 'prisma generate failed' }
npx --workspace=packages/db prisma db push
if ($LASTEXITCODE -ne 0) { throw 'prisma db push failed' }

Write-Host '=== next build (bakes NEXT_PUBLIC_*) ==='
npm run build --workspace=web
if ($LASTEXITCODE -ne 0) { throw 'next build failed' }

Write-Host '=== start services ==='
foreach ($s in $services) {
  if (Get-Service $s -ErrorAction SilentlyContinue) { Start-Service $s; Write-Host "started $s" }
}
if (Get-Service caddy -ErrorAction SilentlyContinue) {
  if ((Get-Service caddy).Status -ne 'Running') { Start-Service caddy }
}
Write-Host 'deploy complete.'
