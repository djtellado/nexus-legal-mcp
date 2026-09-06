# @nexus-legal/mcp

MCP (Model Context Protocol) server for **Nexus Legal** — exposes 27 specialised legal capabilities to Claude Desktop, Claude Code, Cursor and any other MCP-compatible client.

> **What is this?** Connect your Claude to Nexus in 30 seconds. From then on Claude can run ISO 31000 legal analysis, Monte Carlo litigation simulation, case-law search, legal drafting, administrative doctrine, adversarial red teaming, multi-jurisdiction comparison (cross-border), citation verification, procedural time-limit computation, the statute↔case-law citation graph, and analysis of Box files by `file_id` (`box_analyze`) — without leaving the conversation.

---

## Quick install

### 1. Generate an MCP key

Go to [legal.nexusquantum.legal/developers](https://legal.nexusquantum.legal/developers), choose **"MCP server"**, give it a name (e.g. "personal MacBook") and press **+ Create MCP key**. Copy the `nlk_...` key — it is shown only once.

### 2. Configure your client

#### Claude Desktop (macOS)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexus-legal": {
      "command": "npx",
      "args": ["-y", "@nexus-legal/mcp"],
      "env": {
        "NEXUS_API_KEY": "nlk_YOUR_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop. You will see a 🔌 icon in the chat with the 27 Nexus tools available.

#### Claude Desktop (Windows)

Edit `%APPDATA%\Claude\claude_desktop_config.json` with the same contents.

#### Claude Code (CLI)

```bash
claude mcp add nexus-legal -- npx -y @nexus-legal/mcp
# Then set your key:
export NEXUS_API_KEY=nlk_YOUR_KEY_HERE
```

#### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nexus-legal": {
      "command": "npx",
      "args": ["-y", "@nexus-legal/mcp"],
      "env": { "NEXUS_API_KEY": "nlk_YOUR_KEY_HERE" }
    }
  }
}
```

### 3. Try it

In Claude Desktop, type:

> Analyse this contract with Nexus in jurisdiction GB, commercial branch, conservative profile: «[paste the contract text here]»

Claude will call the `nexus_analyze` tool and return the report with certainty locks `[L1]`/`[L2-J]`/`[L3-NV]`/`[L4]`, blocking signals `[L5-C]`/`[L5-P]`, and a `NEXUS-AUDIT-TRAIL` block.

---

## The 27 tools

| Tool | Capability | Typical cost |
|---|---|---|
| `nexus_analyze` | Full legal analysis (Node A — ISO 31000) | 1-3 credits |
| `nexus_consulta` | Open legal question, with or without a document | 1 credit |
| `nexus_draft` | Legal drafting (appeal, claim, defence, clause…) | 2-4 credits |
| `nexus_audit` | Cross-audit of a Node A analysis (Node B) | 1-2 credits |
| `nexus_consensus` | Multi-agent consensus Node A ↔ Node B (analysis + adversarial audit in a loop until consensus; `jurisdiction` required; long operation ~3-6 min) | 3-7 credits |
| `nexus_monte_carlo` | Monte Carlo scenario simulation (ISO 31000 §6) | 4 credits |
| `nexus_doctrina` | Administrative doctrine search, by jurisdiction | 1 credit |
| `nexus_opinion` | Multi-LLM second opinion on a previous analysis | 2 credits |
| `nexus_redteam` | Adversarial red team (vulnerabilities as structured JSON) | 5 credits |
| `nexus_adversarial` | Adversarial argument in prose over a previous analysis | 2-3 credits |
| `nexus_cross_border_compare` | Multi-jurisdiction comparison (2-15 jurisdictions) | 2-4 credits |
| `nexus_jurisprudencia_search` | Semantic search over the multi-jurisdiction case-law corpus | requires balance + the case-law add-on for that jurisdiction |
| `verify_cita` | Deterministic verification of one citation (judgment or provision) against the official corpus | requires balance (+ case-law add-on if the citation is case law) |
| `plazos_calcular` | Procedural time limits by forum. `jurisdiction` is required, no default: `ES` (LEC + LOPJ, CGPJ/regional holidays, August non-working) or `GB-EAW` (CPR r 2.8, *clear days*, England and Wales bank holidays, no August recess). Scotland and Northern Ireland are rejected: their rules and their holidays are different | requires balance |
| `cruce_normativa_jurisprudencia` | Citation graph: provisions ↔ judgments | requires balance + case-law add-on |
| `box_analyze` | Analysis of a Box file by `file_id` (requires an active Box connection) | 1-2 credits |
| `nexus_verificacion` | Verification Centre: checks EVERY citation in a document against the official corpus (deterministic, no LLM cost) | requires balance |
| `nexus_playbook` | Strategic negotiation playbook over a previous analysis | 2-3 credits |
| `nexus_compare_versions` | Comparison of two versions of a document (V1 ↔ V2) | 2 credits |
| `nexus_conflict_check` | Conflict check (conflicts of interest) over the parties to a case file | 1 credit |
| `nexus_inbox` | Firm-wide attention inbox (what needs action) | requires balance |
| `nexus_chat` | Legal chat with the case context | 1 credit |
| `nexus_normativa_search` | Semantic search over legislation in force | requires balance + the legislation add-on for that jurisdiction |
| `nexus_normativa_articulo` | Literal text of a provision at a date (lex temporis) | requires balance + legislation add-on |
| `nexus_normativa_pyramid` | Legislative hierarchy: coverage by level | requires balance |
| `nexus_corpus_coverage` | Inventory of the case-law corpus | read-only |
| `nexus_normativa_coverage` | Legislation corpus coverage (jurisdictions + freshness) | read-only |

> **Billing:** the MCP server is not free. Every call requires an account with a **credit balance > 0** (paid from minute one). Premium content is per **jurisdiction add-on**: **case law** and extra **legislation** are add-ons (Layer 3) — the subscription includes the legislation of one jurisdiction. Without the matching add-on, searches and lookups for that jurisdiction return `403 CONTENT_NOT_ENTITLED`.

**On jurisdictions and coverage.** 63 jurisdiction codes are selectable (`GB`, `ES`, `CO`, `SG`, `US` with the `US-CA`/`US-NY`/`US-DE`/`US-TX` state overlays, `MULTI` for cross-border, and others). Selectable is not the same as grounded: what corpus actually backs a given jurisdiction — how many provisions, when our copy was last written, whether search is enabled for it — varies, and it is not something to infer from this list. Call `nexus_normativa_coverage` with your key: it answers for the jurisdictions **your account** has active, with the figures of each. A jurisdiction with no grounding corpus still analyses, but without literal citation against an official source.

---

## Bring-your-own-engine (BYO) accounts — what you will see before registering one

Some accounts are provisioned so that legal generation runs **only on the firm's own
LLM engine**, with no fallback chain. That is not a limitation: it is the guarantee
that documents never reach a Nexus engine.

While no provider is registered and enabled, **every generative tool**
(`nexus_analyze`, `nexus_consulta`, `nexus_chat`, `nexus_draft`, `nexus_audit`,
`nexus_adversarial`, `nexus_redteam`, `nexus_doctrina`, `nexus_consensus`,
`nexus_monte_carlo`, `nexus_opinion`, `nexus_playbook`, `nexus_compare_versions`,
`nexus_cross_border_compare`, `box_analyze`) returns:

```
Error running nexus_analyze: BYO_PROVIDER_REQUIRED: This account requires its own
BYO LLM engine for AI-generative endpoints … This is a configuration state, not a
transient failure — retrying returns the same 409. Register and enable a provider
via POST /api/v1/llm-providers, then retry.
```

Retrying does **not** fix it, and no credits are charged for a run that stops there.
Register the engine once (`POST /api/v1/llm-providers`, or header → **AI models** in
the application) and run it again.

### Reasoning engines and long analyses

If your engine is a **reasoning model** (DeepSeek V-pro, o1-style, Claude 5 with thinking), a
heavy analysis can take longer than a synchronous HTTP request is allowed to last. The gateway
closes the connection at **300 s** — that ceiling is ours to live with, not to raise.

MEASURED on 2026-08-18: `nexus_analyze` in `mode: "auditoria"` over a ~5 KB contract, on a BYO
DeepSeek engine, went past it and returned `502`. The reason is not a fault in your engine: a
reasoning model spends a large part of its completion budget thinking before it writes, and when
it runs out mid-thought Nexus automatically re-issues the call with a wider budget — which costs
more wall clock again.

Two ways round it, in order of preference:

1. **Use the asynchronous path** for that combination: `POST /api/v1/jobs` with
   `kind: "analyze"` returns `202` and a `jobId` you poll (or a signed webhook). No wall clock.
   This is the right door for reasoning engines and for `auditoria` on large documents.
2. Use `mode: "standard"` through the MCP tool, which is materially shorter.

Platform engines and `mode: "standard"` are unaffected: the synchronous tool is the right one
there and stays the default.

**Read-only** tools work without an engine, because they generate nothing:
`nexus_jurisprudencia_search`, `verify_cita`, `nexus_verificacion`,
`nexus_normativa_search` / `_articulo` / `_pyramid`, `nexus_corpus_coverage`,
`nexus_normativa_coverage`, `cruce_normativa_jurisprudencia`, `plazos_calcular`,
`nexus_conflict_check` (deterministic name matching, no LLM) and `nexus_inbox`.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXUS_API_KEY` | — | **Required.** An `nlk_...` key with `mcp` scope. |
| `NEXUS_BASE_URL` | `https://legal.nexusquantum.legal` | For test or self-hosted environments. |
| `NEXUS_TIMEOUT_MS` | `180000` (3 min) | Timeout for long analyses. |

**Language.** This package sends the same tool descriptions to every client — MCP
publishes them once, in `tools/list`, and no tool here takes a `language` argument —
so descriptions and rendered output are in English. Where a tool produces a legal
deliverable, the language of that deliverable follows the jurisdiction and the account,
not this README.

**You can name the role and the party in your own terms.** `professionalRole` takes
`lawyer`, `solicitor`, `barrister`, `prosecutor`, `notary`, `registrar`, `judge`,
`in-house` and `individual`. `proceduralSide` takes the term your forum actually uses:
`claimant` (England and Wales, CPR r 2.3), `pursuer` (Scotland), `plaintiff` (Northern
Ireland, which did not adopt the CPR), `defendant`, `defender`. The original Spanish wire
values — `abogado`, `demandante`, `auditoria` — are unchanged and will keep working: this
adds spellings, it does not retire any. Everything resolves to the same protocol value
before it reaches the analysis, so the two are interchangeable in every call.

**API version:** this server speaks to the Nexus **v1 API**, the same one used by the
[TypeScript](https://www.npmjs.com/package/@nexus-legal/sdk) and
[Python](https://pypi.org/project/nexus-legal/) SDKs. Read-only and verification tools
call `/api/v1/*` routes; generative ones enter through the backend node routes with the
same `nlk_` key (`mcp` scope), the same billing and the same BYO enforcement.

This stdio package exposes **27** of the catalogue's capabilities. The **remote
connector** (`https://legal.nexusquantum.legal/api/mcp`, nothing to install) also
exposes the case-file, firm-memory, firm-governance, legal-analytics, account and billing
capabilities. If you need any of those, use the remote connector or the v1 API directly.

---

## Privacy and GDPR

- **Zero Retention on EU infrastructure.** Documents you send via MCP are processed in RAM on Railway europe-west4-drams3a (Netherlands) and are NOT persisted to a database by default. The Nexus Zero Retention policy applies to 100% of MCP traffic exactly as it does to web traffic.
- **PII Gatekeeper.** Before anything reaches the LLM, the backend anonymises national ID numbers, IBANs, phone numbers, emails and account numbers with reversible tokens (`[DNI_1]`, `[ACCOUNT_3]`…). The MCP client only ever sees output already re-identified by our pipeline.
- **Audit.** Every tool call is recorded in `analysis_costs` and `api_usage_stats` (with `via_api_key_id`) for billing and traceability.

---

## Support

- Email: support@nexusquantum.legal
- Documentation: https://legal.nexusquantum.legal/developers
- Issues: https://github.com/djtellado/nexus-legal-prod/issues

---

## Licence

Apache-2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

Copyright 2026 Nexus Legal · Quantum Nexus Ventures.
