# Agent Note: Adopt a six-layer agent memory model for DSH

Status: implemented

English | [中文](2026-08-30-six-layer-agent-memory-model.zh.md)

## Problem

The repository had a rich but single-purpose `AGENTS.md` (151 lines) that mixed entry instructions, working facts (build commands, sandbox policy, testing recipes, vendoring), and the agent protocol for using `.agents/notes/`. A human reader found it adequate, but an agent session that follows it ends by appending to `AGENTS.md`, `LOCAL-SETSET.md`, or an ad-hoc `audit_log` file.

The two problems compound: `AGENTS.md` conflates stable rules with transient facts, and there is no single current-state snapshot for handoff. Agents append chronology ("tried X, failed", "bwrap ENOENT", "zombie package.json") into files that grow without bound, forcing every later session to read the accumulated log to recover three actionable facts. An external `audit-2026-08-30.json` provider-rating file was also copied into workspace memory and treated as an agent knowledge source, conflating an environment-specific experiment with repo-level truth.

## Decision

Adopt a six-layer memory model that maps each question agents ask to exactly one file, and never store history in memory files.

| Layer | File | Role | Updated by |
|---|---|---|---|
| Entry protocol | `AGENTS.md` (root) | Constitution + start/end protocol + links | Humans (rarely) |
| Current state | `.agents/HANDOFF.md` | Rewritten in full each session — never appended | Agent at end of session |
| Active plan | `.agents/plans/<task>.md` | Checklist (`## Goal`, `## Checklist`, `## DoD`) | Agent during work |
| Living knowledge | `.agents/knowledge/<topic>.md` | Current facts, pitfalls (facts only, no chronology) | Agent when stable knowledge is learned |
| Formal decisions | `.agents/notes/.../yyyy-mm-dd-topic.md` | Decision records (ADR ≡ `architecture` class; no `docs/adr/`) | Agent for non-trivial decisions |
| History | `git log`, PR descriptions | Real audit log | Automatic |

The protocol an agent follows each session:

- **Start:** read `AGENTS.md` → `.agents/HANDOFF.md` → active plan → topic knowledge as needed.
- **End / significant step:** (1) rewrite `.agents/HANDOFF.md` in full; (2) update the active plan checklist; (3) fold stable facts into `.agents/knowledge/<topic>.md`; (4) record significant decisions as an Agent Note; (5) confirm `HANDOFF.md` is current before saying "done".

Key harmonization rules (the "embed, don't duplicate" principle):

- Do **not** create a parallel `.agent/` directory — everything lives inside the existing `.agents/`.
- Agent Notes of class `architecture` are the ADR equivalent — do **not** create `docs/adr/`.
- `.agents/HANDOFF.md`, `.agents/plans/`, `.agents/knowledge/` are exempt from `verify-agent-note-format`, `verify-translation-pairing`, and `verify-doc-budgets` by scope (the verifiers only walk `.agents/notes/`).
- `.agents/notes/` is unchanged — its format gate, bilingual pairing, lifecycle/class taxonomy, and archive rules remain authoritative.
- The external `audit-2026-08-30.json` is **not** imported into the repo; only DSH-relevant facts it surfaced (`bwrap` unavailable, zombie `package.json)` artifacts) are folded into `.agents/knowledge/sandbox.md` as re-checkable one-liners.
- No chronology in `knowledge/`. Facts mark re-checkability: "Observed as of `<date>`; re-check with `<command>`."

`AGENTS.md` is reduced from 151 lines to an entry point under the 1400-word budget in `scripts/doc-budgets.manifest.json`, linking to `knowledge/*` for detail rather than restating it.

## Alternatives considered

**One giant `memory.md` appending every action.** Rejected because a single append-only file grows without bound; models lose actionable facts among the noise. The six-layer split keeps each question answerable from one small file.

**Move everything to `.agents/notes/`.** Rejected because Agent Notes are formal decision records with a strict format gate and bilingual pairing. Working files (HANDOFF, plans, knowledge) need rewrite-in-place semantics and no format ceremony; forcing them through the note gate would either break the gate or require exempting `notes/` itself.

**Relocate to `.agent/` (singular) alongside `.agents/`.** Rejected outright — it creates a second directory for the same purpose, a second source of truth, and the exact ambiguity the original critique warned against.

**Keep `README.md`-style prose + an append-only `audit_log`.** This is the status quo being adopted *out of*. README describes the product to humans; `audit_log` is chronology agents do not need. The six-layer model separates human docs, current state, active plans, living knowledge, formal decisions, and history.

## Consequences

- `-151` lines of mixed fact-and-protocol in root `AGENTS.md`; the same content is now split into `knowledge/*.md` (rewriteable working facts) and `AGENTS.md` (entry point + protocol, ~900 words).
- `.agents/notes/` format gate, translation pairing, and tree walkers are unchanged — the new working directories are naturally out of their glob scope (`.agents/notes/lifecycle/**/*.md`).
- Pre-existing verifier violations are **not** introduced by this change (see [.agents/HANDOFF.md](../../../../.agents/HANDOFF.md)).
