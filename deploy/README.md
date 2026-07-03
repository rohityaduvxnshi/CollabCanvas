# CollabCanvas — VPS Deploy Runbook

Target: Windows Server 2022 VPS `144.172.98.43` (`ssh -i ~/.ssh/dashboard_vps
Administrator@144.172.98.43`, PowerShell shell). Domain `dash-board.in` has
`@`, `www`, `*` A records → this VPS. Caddy v2.11.4 at `C:\caddy.exe`.

```
collabcanvas.dash-board.in     → Next.js web   (127.0.0.1:3000)
collabcanvas-ws.dash-board.in  → Yjs WS server (127.0.0.1:4000)
PostgreSQL 17 local            → 127.0.0.1:5432, db "collabcanvas"
Caddy                          → :80/:443, HTTPS certs auto (per-host ACME)
```

**Current VPS state (as of 2026-07-02, before the deploy freeze):**
- Node v22.23.1 installed ✓
- PostgreSQL 17.7 binaries at `C:\Program Files\PostgreSQL\17` but service NOT
  registered (installer interrupted) — `vps-setup.ps1` finishes it deterministically
- Leftovers to clean: `pginstall` scheduled task, `C:\pg-setup.exe`, `C:\node-setup.msi`
- Caddy not running; nothing listening on 80/443; firewall untouched

## Layout on the VPS

```
C:\apps\collabcanvas\   ← repo (source, built on the box)
C:\apps\caddy\Caddyfile ← global Caddy config; imports sites\*.caddy
C:\apps\caddy\sites\    ← one file per site (portfolio block goes here too)
C:\apps\winsw\          ← WinSW service wrappers (3 services)
C:\apps\logs\           ← service logs (rolled)
```

## Steps — (you) before the green light

1. **GitHub OAuth app**: homepage `https://collabcanvas.dash-board.in`,
   callback `https://collabcanvas.dash-board.in/api/auth/callback/github`.
2. **Google OAuth client** (Web): authorized origin
   `https://collabcanvas.dash-board.in`, redirect URI
   `https://collabcanvas.dash-board.in/api/auth/callback/google`.
3. Have the 4 values ready (GitHub id/secret, Google id/secret) — paste them
   into the env files on the VPS yourself, or hand them to me at deploy time.
4. Hosting-provider firewall: make sure TCP 80 + 443 are allowed in (the
   Windows-firewall side is scripted; the provider panel is yours).
5. (Anytime) delete the two old Vercel projects `dash-board` + `dashboard1607`.

## Steps — (me) on the green light

1. `scripts/vps-setup.ps1` — finish Postgres (initdb if needed, register
   service as NetworkService, ACLs), create `collabcanvas` role + db, Windows
   firewall 80/443, clean leftover installers/task.
2. Package repo (tar, no node_modules/.next/.git) → `scp` → extract to
   `C:\apps\collabcanvas`.
3. Write real env files from `env/*.example` (fresh `AUTH_SECRET`,
   `WS_JWT_SECRET`, db password; your OAuth values).
4. `scripts/vps-deploy.ps1` — `npm ci`, `prisma generate` + `prisma db push`,
   `next build` (NEXT_PUBLIC_* bakes at build), (re)start services.
   `db push` note: schema-sync without migration history — fine for a
   single-app DB; switch to real migrations when the Notion-lite phases start
   changing the schema regularly.
5. Install the 3 WinSW services (web / ws / caddy) — auto-start on boot,
   auto-restart on crash, rolling logs.
6. Verify from the outside: `https://collabcanvas.dash-board.in` (200, OAuth
   login), `https://collabcanvas-ws.dash-board.in/health` (200), two-browser
   real-time sync over WSS.

## Ops notes

- **One Caddy owns :80/:443.** Add your portfolio as
  `C:\apps\caddy\sites\portfolio.caddy` (e.g. `dash-board.in { root * C:\sites\portfolio; file_server }`),
  then `C:\caddy.exe reload --config C:\apps\caddy\Caddyfile`.
- **Backups are on us now** (no managed DB): `pg_dump collabcanvas` — worth a
  weekly scheduled task once real users exist.
- Redeploy = re-run steps 2 + 4 (services restart at the end of the script).
