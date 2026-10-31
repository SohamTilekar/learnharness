# Automata Co-Hosting & Subpath Deployment (`/learn`)

This document outlines how LearnHarness is deployed and co-hosted within **[Automata](https://github.com/SohamTilekar/automata)** on a Google Cloud VM under the `/learn` subpath (`https://automata.mywire.org/learn`).

---

## 1. High-Level Architecture

LearnHarness and Automata run within the **same single Node.js runtime instance** managed by PM2 (`mcp-server`) on port 3000 behind an Nginx reverse proxy (SSL termination on port 443).

```
                             [ User Browser / AI Client ]
                                          │
                                          ▼ HTTPS (:443)
                         ┌─────────────────────────────────┐
                         │    Nginx Reverse Proxy (:443)   │
                         │   SSL Termination & Buffering   │
                         └────────────────┬────────────────┘
                                          │ HTTP (:3000)
┌─────────────────────────────────────────▼────────────────────────────────────────┐
│                   SINGLE NODE.JS RUNTIME INSTANCE (PM2: mcp-server)              │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Automata Express Application Engine                    │  │
│  │                                                                            │  │
│  │   ├── /mcp, /sse, /messages  ──► Obsidian Vault MCP Server (OAuth 2.0)     │  │
│  │   ├── /admin/*               ──► Command Cockpit & Software Factory API    │  │
│  │   ├── /health                ──► System Telemetry & Diagnostics            │  │
│  │   ├── /                      ──► Landing Page Cockpit                      │  │
│  │   │                                                                        │  │
│  │   └── /learn*, /api*, /_next*                                              │  │
│  │               │                                                            │  │
│  │               ▼ In-Memory Programmatic Request Delegation                  │  │
│  │     ┌───────────────────────────────────────────────────────────────┐      │  │
│  │     │   LearnHarness App Router Engine (NextNodeServer)             │      │  │
│  │     │ • Root Directory: ~/learnharness                              │      │  │
│  │     │ • BasePath: /learn                                            │      │  │
│  │     │ • Mode: Production (dev: false)                               │      │  │
│  │     │ • AI Engine: @earendil-works/pi-ai + pi-agent-core            │      │  │
│  │     │ • Pre-flight Gate: pi-antigravity verified                    │      │  │
│  │     │ • Data: ~/learnharness/data/ (chats + graph ledgers)          │      │  │
│  │     └───────────────────────────────────────────────────────────────┘      │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Separation of Concerns & Clean Boundaries

1. **Independent Git Repositories**:
   LearnHarness lives in its own Git repository (`~/learnharness` on branch `feat/pi-antigravity`). It is **never** vendored or copied into Automata's codebase.
2. **Dynamic `basePath`**:
   `next.config.ts` dynamically evaluates:
   ```ts
   basePath: process.env.BASE_PATH || undefined,
   ```
   When building for Automata (`BASE_PATH=/learn npm run build`), Next.js prefixes all client-side navigation (`<Link>`, router `pushState`) and assets (`/learn/_next/static/...`) with `/learn`.
   When unset (desktop Electron or local development), it evaluates to `undefined`, operating as root `/`.
3. **In-Process Request Handling**:
   Automata's `src/learn/learnBridge.ts` loads Next.js dynamically via `createRequire` and dispatches requests directly to `nextApp.getRequestHandler()`. There is no inter-process network latency or secondary port.
4. **Fault Isolation & Auto-Recovery**:
   LearnHarness is wrapped in an autonomous error boundary. If Next.js throws an error or restarts, incoming `/learn` requests receive a graceful HTTP 503 while Automata's MCP server and Discord Gateway bot remain 100% online.

---

## 3. Remote Deployment (`scripts/deploy-to-vm.sh`)

Rather than taxing the low-powered 1GB VM with a heavy Turbopack build, LearnHarness uses a fast local build & lightweight bundle transfer:

```bash
# Standard safe deployment (remote data/ is preserved):
./scripts/deploy-to-vm.sh

# Target a different VM:
./scripts/deploy-to-vm.sh user@hostname

# Intentionally sync local chats & graph data to the VM:
./scripts/deploy-to-vm.sh --overwrite-data

# Only generate the compressed build archive without uploading:
./scripts/deploy-to-vm.sh --archive-only
```

### What the Script Does:
1. **Pre-flight Check**: Runs `node scripts/verify-antigravity.mjs` to ensure the `pi-antigravity` extension and active Google account are valid.
2. **Local Compilation**: Builds Next.js locally with `BASE_PATH=/learn npm run build` (~20–30s on your workstation).
3. **Lightweight Tarball**: Packages `.next` (excluding dev/cache/standalone) into a single 32MB `.tar.gz` bundle.
4. **Fast Transfer**: Transfers the 32MB file to the remote VM via SCP in ~4 seconds.
5. **Safe Extraction**: Extracts the bundle into `~/learnharness/.next` on the VM.
6. **Data Preservation**: The remote `data/` directory (`~/learnharness/data/chats/`, `data/graph/`, `data/settings.json`) is **never touched or overwritten** unless `--overwrite-data` is explicitly provided.
7. **PM2 Reload**: Triggers a zero-downtime reload of `mcp-server` under PM2.

---

## 4. Disaster Recovery & Data Retention

LearnHarness stores all session transcripts and knowledge graphs on the VM at:
```
~/learnharness/data/
├── chats/*.json          # Full transcripts of every tutoring lesson
├── graph/*.jsonl         # Reasoning chains and propositions forming the knowledge graph
└── settings.json         # Configured model slots (strong, cheap, vision)
```

To back up your VM data to your local workstation:
```bash
rsync -avz sohamtilekar233@35.209.219.191:~/learnharness/data/ /mnt/soham/soham_code/learnharness/data/
```
