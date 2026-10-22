# Networking & Remote Access — Knowledge App

How the self-hosted stack (Trilium, Radicale, the intelligence service) gets reached from phones/laptops/business devices, and why. See `HANDOFF.md` for the doc map and current status.

## Connectivity constraint (applies project-wide)

User's self-hosted infrastructure is reachable only via local network or Tailscale — deliberately not public-facing, consistent with the project's privacy stance from the start (self-hosted, "wouldn't keep anything remotely private" on someone else's cloud). Trilium's own web/mobile UI and standard CalDAV clients (e.g. DAVx⁵) already handle this correctly (local-first storage/cache, opportunistic sync, no permanent-connection assumption) — nothing to change there. **The one piece this constrains that wasn't obvious upfront: the game UI itself**, which must be built local-cache-first (layout data, task list, relevant note content cached client-side, reconciled when reachable) rather than assuming a live connection to either Trilium or Radicale — see `game-ui.md`.

## Decision: plain Tailscale, not a tunnel service

Researched Cloudflare Tunnel / Tailscale Funnel / ngrok as "access homelab without VPN/port-forwarding" options — all three put a third party in the traffic path (Cloudflare Tunnel terminates at their edge and sees plaintext by default; Funnel is still beta with a May-2026 DoS bug; ngrok is built for temporary debugging, not persistent access) — none fit the stated privacy bar.

**Plain Tailscale** (mesh VPN, WireGuard-based peer-to-peer once the coordination handshake completes) is the actual fit: no third party sees plaintext, no ports opened. If a fully third-party-free tunnel is ever wanted instead (e.g. for something meant to be genuinely public), **frp** or **rathole** (self-hosted reverse tunnel, both ends under your control via a rented VPS) is the option — dependability then equals your own VPS provider's uptime, not a vendor's.

## Practical realities of the Tailscale switch

User currently runs WireGuard on their Fritzbox, and raised two specific concerns — checked both:

**Can't run ProtonVPN + a homelab VPN simultaneously on Android.** This is an **Android platform limit — only one active VPN (VpnService) per profile** — not a WireGuard-specific problem, and switching to Tailscale does **not** by itself fix it, since Tailscale is also a VPN client competing for the same single slot. Real fixes:
1. **Tailscale's Mullvad exit-node add-on** ($5/mo per 5 devices) — routes general internet traffic through Mullvad as an exit node *inside* the same tailnet, so one connection covers both private homelab access and general VPN privacy, eliminating the conflict rather than working around it. Means dropping ProtonVPN specifically in favor of Mullvad-via-Tailscale — a real switch to decide on, not assume.
2. **Keep ProtonVPN, run Tailscale isolated in an Android Work Profile** (e.g. via the Shelter app) — Android allows one VPN per *profile*, and a work profile is a separate profile, so both providers coexist at the cost of maintaining a second profile.

**Resolved**: user confirmed the primary need is just reaching the server, which **plain Tailscale (phone ↔ server, no ProtonVPN involved at all) already fully solves with zero extra setup** — server access and general-browsing privacy are two separate needs, don't conflate them. Get the simple server-access case working and lived-with first.

**If general-browsing-through-Proton is wanted later** (so Proton's own app isn't needed on the phone at all): technically real, with a documented pattern. Tailscale's native (free) exit-node feature routes other devices' default traffic through a chosen tailnet node; making that node itself egress via ProtonVPN requires a second network namespace on the server running Proton's WireGuard tunnel, with `fwmark`-based routing rules so Tailscale's own control traffic isn't mistakenly routed into the VPN tunnel it depends on (a known chicken-and-egg problem with a documented fix). ProtonVPN officially publishes WireGuard config files for exactly this kind of manual/router/server setup — sanctioned use, not against ToS. Caveats:
- **No automatic kill-switch** with a manual config (that's an app-only feature) — a dropped tunnel could leak traffic out the home IP unless a firewall rule blocks egress when it's down.
- **Real performance cost**: phone→server→Proton→internet instead of phone→Proton→internet directly; home upload bandwidth becomes the ceiling for this traffic.
- Treat as a separate, optional, later project — not a prerequisite for the core "reach my server" need, which is already solved without it.

**Locked-down business devices**: Tailscale has an **official browser-based access feature** for exactly this ("devices that can't run Tailscale" is a first-class documented use case) — connect via a web console with zero client install. Better fit than a public tunnel workaround, stays inside Tailscale's own trust model.

## Backup / disaster recovery — decided 2026-09-25

Responds to the persona debate's (`persona-debate.md`, archived outside this repo) top-severity finding: no disaster-recovery story existed for the single home machine everything runs on. **Decision: automated encrypted off-site backup to Proton Drive**, using the existing Proton Premium subscription. Cadence: **daily** — confirmed sufficient for now, revisit only if that turns out too coarse in practice.

- **Decided 2026-09-25: use the official Proton Drive CLI, not rclone.** A second Proton account isn't available (confirmed), so the deciding factor is credential safety on the single main account, and the official CLI is meaningfully better on that axis: it authenticates via a **session token stored in the OS keychain, never a raw password or the 2FA secret** — sign-in is a browser flow, the CLI never handles real credentials directly. A session token is also independently revocable (kill that one session from Proton account settings without touching the real password) — unlike rclone's Proton backend, which needs the actual TOTP secret stored to authenticate unattended. It's also simply the right-shaped tool for a **daily** job: it's a one-shot job runner by design, not a continuous-sync daemon, matching the confirmed cadence exactly — rclone's continuous-sync/mount features aren't needed here.
- **Honest limit, not fully solved by the official CLI**: Proton still has no scoped/read-only/folder-limited credential as of mid-2026 — a session token, once granted, can reach the whole account, not just a backup folder. Switching to the official CLI reduces this risk substantially (revocable token vs. a permanent stored secret) but doesn't eliminate the "if this leaks, it's not just a backup folder" concern the way a dedicated account would have.
- **Mitigation that closes the gap regardless of tool: encrypt the backup payload before it ever reaches Proton** (e.g. `tar` + `age`/`gpg`, keyed to something that lives only on the home server). Even in the worst case — session token leaked, full account reached — what's sitting in Proton Drive is ciphertext, not readable notes. Doesn't depend on trusting Proton's account security at all.
- **Headless cron setup detail**: use the CLI's `pass` (GPG-encrypted password-store) credential store for the session token, not the default OS-keychain backend (awkward headless, needs a `dbus-run-session` wrapper) or `unsafe_file` (explicitly testing-only in Proton's own docs — avoid for anything real).
- Storage likely already covered by existing Proton Premium quota — Trilium/Radicale text data compresses well; only a concern if there are heavy image attachments.
- **Still required regardless of backend**: periodically test an actual restore, not just confirm the push succeeded — an unverified backup isn't a backup (per the same debate finding).

**Fritzbox has no native Tailscale support** (confirmed, unlike its built-in WireGuard server) — Tailscale requires installing its client on an always-on home device and connecting to *that device* as a mesh node, not "the network" as a whole like the current router-level WireGuard setup. This fits the existing plan without extra work: install Tailscale directly on the same always-on machine that will run Trilium + Radicale, and reach it as a normal tailnet node — no Fritzbox involvement or subnet-router/static-route setup needed unless whole-home-LAN access (beyond just that server) is also wanted later.
