# dash-board.in — Deployment & Portfolio Plan

Goal: `dash-board.in` becomes your project portfolio (designed + deployed by
YOU). CollabCanvas lives at a subdomain, fully self-hosted on your Windows VPS
(144.172.98.43, Server 2022). Later, CollabCanvas grows a "Notion-lite" track.

**REVISED after VPS decision** (original Vercel/Fly/Neon plan below kept for
reference; superseded):

```
dash-board.in                     → Portfolio (yours — you design & deploy)
collabcanvas.dash-board.in        → CollabCanvas web (Next.js, VPS :3000)
collabcanvas-ws.dash-board.in     → WS sync server (Node, VPS :4000)
PostgreSQL on the VPS (127.0.0.1) → users, boards, members, snapshots
C:\caddy.exe                      → HTTPS reverse proxy for both subdomains
```

- DNS already done: `@`, `www`, and `*` A records → VPS. Wildcard covers both
  single-label subdomains; Caddy auto-issues certs per hostname.
- Caddy is SHARED infrastructure (one process owns :80/:443). Config uses an
  imports dir — `C:\caddy\sites\collabcanvas.caddy` is mine; drop your
  portfolio site block in the same dir and reload.
- No keep-alive needed (VPS never sleeps). No Neon (Postgres local to the box —
  honest trade-off: backups are on us now).
- Web + WS + Caddy run as auto-restarting Windows services (WinSW).
- Survey findings: Caddy v2.11.4 present but not running; no Node (installing
  LTS); nothing listening on 80/443 — the box serves nothing today.
- Remaining user-side items: GitHub + Google OAuth apps with callbacks
  `https://collabcanvas.dash-board.in/api/auth/callback/{github,google}`, and
  (if the site is unreachable from outside) opening 80/443 in the hosting
  provider's firewall panel.

---

## Original (superseded) Vercel/Fly plan — kept for reference

---

## Part 1 — Clear the current site

Found in your Vercel account ("Rohit's projects"):

| Project | Latest deploy | Custom domain |
|---|---|---|
| `dash-board` | READY (prod) | none attached (only *.vercel.app) |
| `dashboard1607` | READY (prod) | none attached |

Neither shows `dash-board.in` attached, so whatever is live on the domain today
is wired at GoDaddy (forwarding, or their site builder) or the domain isn't
resolving to Vercel at all. **You:** check GoDaddy → dash-board.in → DNS. If
there's website-builder/forwarding config, remove it — the plan below replaces
all of it. The two old Vercel projects: recommend deleting `dashboard1607` and
repurposing (or deleting) `dash-board` once the new portfolio project exists.

## Part 2 — Deploy CollabCanvas to canvas.dash-board.in

Split of work — **(you)** = accounts/credentials I can't create.

1. **(you) Neon**: create a free project → copy the pooled `DATABASE_URL`.
2. **(me) Migrations**: generate real Prisma migrations against Neon
   (`prisma migrate dev` once, committed; local dev keeps `db push`).
3. **(me) Fly config**: `Dockerfile` + `fly.toml` for `/ws-server`
   (`min_machines_running = 1`, health check on `/health`).
4. **(you) Fly**: `fly launch` with my config + `fly secrets set DATABASE_URL
   WS_JWT_SECRET` (I'll hand you the exact commands). Cost honesty: Fly has no
   free allowance for new orgs — one always-on shared-cpu-1x ≈ **$2–4/mo**.
   Free alternative: Koyeb's free instance (no sleep), less battle-tested.
5. **(me) Vercel**: deploy `/web` (root dir `web`, npm-workspace aware) to a
   new project `collabcanvas`.
6. **(you) Vercel env** (Settings → Environment Variables — MCP can't set
   secrets): `AUTH_SECRET`, `AUTH_GITHUB_ID/SECRET`, `AUTH_GOOGLE_ID/SECRET`,
   `DATABASE_URL`, `WS_JWT_SECRET` (same value as Fly), `NEXT_PUBLIC_WS_URL=
   wss://<fly-app>.fly.dev`.
7. **(you) OAuth apps**: add prod callbacks
   `https://canvas.dash-board.in/api/auth/callback/github` and `/google`.
8. **(you) GoDaddy DNS**:
   - `canvas` CNAME → `cname.vercel-dns.com`
   - root `@` A → `76.76.21.21`, `www` CNAME → `cname.vercel-dns.com`
9. **(me) Domains on Vercel**: attach `canvas.dash-board.in` to collabcanvas,
   `dash-board.in` to the portfolio project.
10. **(you) UptimeRobot**: ping `https://<fly-app>.fly.dev/health` every 5 min.
11. **(me) Verify end-to-end**: HTTPS/WSS, OAuth login, two-machine collab.

Note: we're pulling Phase 7 forward — Phases 5 (offline/history) and 6
(hardening: token-expiry reconnect, rate limits, SIGTERM flush) land AFTER the
first deploy, onto the live URLs. Fine for a staging-quality launch; the README
stays honest about it.

## Part 3 — Portfolio landing page (dash-board.in)

- New, separate folder/repo (`c:\GitHub\dash-board`) — one-page Next.js static
  site. Not part of this monorepo; it's your personal site.
- Content: name + one-liner, project cards (CollabCanvas → canvas.dash-board.in
  + GitHub link), placeholder cards for future projects, contact links.
- Design: either reuse CollabCanvas's neo-brutalist system (fast, consistent
  brand) or run a fresh Claude Design pass like we did for CollabCanvas.

## Part 4 — Notion-lite track for CollabCanvas (after Phases 5–6)

All of it rides the existing Yjs + presence + offline stack — that's the point.

| Phase | Feature | How |
|---|---|---|
| N1 | Rich card descriptions: links, bold, lists | TipTap editor bound per-card to a `Y.XmlFragment` via `y-prosemirror`; collaborative text cursors come with the binding |
| N2 | Tables | TipTap table extension in the same editor |
| N3 | Doc pages | New `Page` entity beside boards — full-page TipTap doc, own room (`page:<id>`), sidebar listing boards + pages. This is the real "Notion-lite" move |
| N4 | Polish | Slash-command menu, todo/checkbox blocks, page-to-page links |

Honest scope line (for the README): no databases-with-views, no block-level
permissions, no comments — kanban + collaborative docs, not Notion parity.

## Order of execution

1. You: Neon + Fly + OAuth prod callbacks + GoDaddy DNS edits (Part 2 "you" items)
2. Me: Fly config, migrations, Vercel deploys, domain attach, e2e verify
3. Me: portfolio landing page → dash-board.in
4. Me: CollabCanvas Phases 5 → 6 → 8 (README) on the live deployment
5. Me: Notion-lite N1 → N4
