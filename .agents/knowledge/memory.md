# Agent memory protocol — six-layer model

This file is the **canonical protocol** for agent memory in this repo.
`AGENTS.md` carries a 5–6 line summary and points here.

## Six layers (the four questions, expanded)

| # | Layer | Location | Nature | Who updates | Lifetime |
|---|---|---|---|---|---|
| 1 | Entry protocol | `AGENTS.md` (root) | Constitution + start/end protocol + links | Humans (rarely) | Stable |
| 2 | Current state | `.agents/HANDOFF.md` | **Rewritten** in full each session — never appended | Agent at end of session | Per session |
| 3 | Active plan | `.agents/plans/<task>.md` | Checklist with `## Goal`, `## Checklist`, `## DoD` | Agent during work | Per task; archive/delete when done |
| 4 | Living knowledge | `.agents/knowledge/<topic>.md` | Facts, pitfalls, current stable truths | Agent when something stable is learned | Rewrite, not append; consolidate >300 lines |
| 5 | Formal decisions | `.agents/notes/{proposed,implemented,rejected,archived}/<class>/<date>-<topic>.md` | Decision records (ADR ≡ `architecture` class; no `docs/adr/`) | Agent for non-trivial decisions; humans for sign-off | Immutable once archived |
| 6 | History | `git log`, PR descriptions | Real audit log | Automatic | Forever |

`.agents/HANDOFF.md`, `.agents/plans/`, `.agents/knowledge/` are **working
files**, exempt from `scripts/verify-agent-note-format.ts`,
`scripts/verify-translation-pairing.ts`, and `scripts/verify-doc-budgets.ts`.
`.agents/notes/` keeps its format gate, bilingual pairing, lifecycle/class
taxonomy, and archive rules.

## Protocol

**Session start:** read `AGENTS.md` → `.agents/HANDOFF.md` → active plan in `.agents/plans/` → topic knowledge in `.agents/knowledge/` as needed.

**Session end / significant step:** (1) **rewrite** `.agents/HANDOFF.md` in full — never append; (2) update the active plan's checklist; (3) fold stable facts into `.agents/knowledge/<topic>.md`; (4) a significant decision (behavior, contract, on-disk format, new architecture) → write or update an Agent Note in `.agents/notes/` (mandatory for non-trivial changes in the same PR — see `.agents/notes/README.md#when-to-write-one`); (5) do not store chronology — history is in `git log`. Before saying "done", confirm `HANDOFF.md` is current.

## Knowledge layer contract

`knowledge/<topic>.md` files hold **current facts**, not decision records. They
capture what the codebase actually does, what breaks, and what to do about it —
stable, non-obvious, and worth not rediscovering each session.

- **Rewrite, don't append.** Each file is replaced in full when stale or >300 lines; old facts deleted, not footnoted. History lives in `git log` and `.agents/notes/`.
- **One home for each fact.** Don't duplicate build commands across AGENTS.md, knowledge, and HANDOFF — link instead.
- **Facts, not opinions.** No "we think" or "maybe try". Every line states an observable truth or a named remedy ("X fails because Y; run `cmd`").
- **No chronology.** "Tried X, failed" is git history. Instead: "X fails because Y; use Z".
- **Mark stale-recheckable facts.** If a fact may go stale, write it as: "Observed as of `<date>`; re-check with `<command>`."

## Topic list

- `knowledge/build.md` — build, package, workspace, and launch facts
- `knowledge/sandbox.md` — DSH file/sandbox policy in this environment
- `knowledge/testing.md` — how tests actually run locally; what CI checks
- `knowledge/deploy.md` — systemd user service update/restart checklist
- `knowledge/memory.md` — this file
