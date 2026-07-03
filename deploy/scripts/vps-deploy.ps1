# Build + (re)start CollabCanvas on the VPS. Idempotent — run for every deploy.
# Expects: repo extracted at C:\apps\collabcanvas, env files already in place
# (web\.env.production, ws-server\.env — see deploy\env\*.example).
#   powershell -ExecutionPolicy Bypass -File vps-deploy.ps1
$ErrorActionPreference = 'Stop'
$repo = 'C:\apps\collabcanvas'
Set-Location $repo

# Prisma CLI needs DATABASE_URL; read it from the ws env file (same DB).
$dbUrl = (Get-Content "$repo\ws-server\.env" | Select-String '^DATABASE_URL=').ToString() -replace '^DATABASE_URL=', ''
if (-not $dbUrl) { throw 'DATABASE_URL missing from ws-server\.env' }
$env:DATABASE_URL = $dbUrl

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

Write-Host '=== restart services (if installed) ==='
foreach ($s in 'collabcanvas-ws', 'collabcanvas-web') {
  if (Get-Service $s -ErrorAction SilentlyContinue) { Restart-Service $s }
}
if (Get-Service caddy -ErrorAction SilentlyContinue) {
  if ((Get-Service caddy).Status -ne 'Running') { Start-Service caddy }
}
Write-Host 'deploy complete.'
