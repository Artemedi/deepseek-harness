# AGENTS.md

DeepSeek Harness is a plugin-based agent harness on vendored Cordis: **everything is a plugin**. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation. See [`.agents/knowledge/memory.md`](.agents/knowledge/memory.md) for the full agent memory protocol and six-layer map.

## Pre-release stance

**Remove before first tagged release.** No external consumers yet — prefer the correct foundation over compatibility shims; backends reject old on-disk formats. Full policy in [`.agents/knowledge/build.md`](.agents/knowledge/build.md).

## Repository layout

```
vendor/      Vendored Cordis source
packages/    @deepseek-ai/dsh-<pkg> workspaces (core, api, typert, llm, shell, fs, skill, web, compaction, context, subagent, bundle, workflow, todo, plan, preset, guard, session, identity, settings, credentials, acp, interaction, boot, sdk, experimental, util)
python/      Python SDK + runtime
native/      node-addon-landland source of record
examples/    Runnable cordis.yml leaves
.agents/     Agent workflows + memory (notes, knowledge, plans, HANDOFF.md, skills)
docs/        Architecture, catalogs, cookbook, postmortics
scripts/     Repo gates and generators
website/     VitePress projection
```

Package groups: [packages/README.md](packages/README.md). `.agents/` sublayers: [`.agents/knowledge/memory.md`](.agents/knowledge/memory.md).

## Commands

See [`.agents/knowledge/build.md`](.agents/knowledge/build.md) for the full command table, launch recipes, source-vs-artifact rules, `cordis.yml` composition, and vendoring.

### Host sandbox failures

When required `gh`, `pnpm`, build, test, or generator commands fail because the agent sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation before diagnosing authentication or project failure. Require sandbox evidence; never bypass genuine test failures or the product sandbox under test. Current facts: `workspace-write` policy, `bwrap` unavailable. See [`.agents/knowledge/sandbox.md`](.agents/knowledge/sandbox.md).

### Run relevant checks locally

Run checks before pushes via [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report only commands run. After `gh stack sync`, validate immediately; do not merge before checks pass. Match evidence to the surface; CI owns exhaustive coverage. Full policy: [`.agents/knowledge/testing.md`](.agents/knowledge/testing.md).

## Agent memory protocol

**Session start:** read `AGENTS.md` → [`.agents/HANDOFF.md`](.agents/HANDOFF.md) → active plan in [`.agents/plans/`](.agents/plans/) → topic knowledge in [`.agents/knowledge/`](.agents/knowledge/) as needed.

**Session end:** (1) **rewrite** `.agents/HANDOFF.md` in full; (2) update the active plan checklist; (3) fold stable facts into `.agents/knowledge/`; (4) record decisions as an Agent Note in `.agents/notes/` (ADR ≡ architecture class; no `docs/adr/`); (5) do not store chronology — history is in `git log`. Before saying "done", confirm `HANDOFF.md` is current. Detail: [`.agents/knowledge/memory.md`](.agents/knowledge/memory.md).

## Secrets / .env

Real-API tests read `DEEPSEEK_API_KEY` + `.env`; never commit credentials. `!!js` (never `!js`) in cordis.yml `config`/`disabled`. Full policy: [docs/cordis-primer.md#loader-configuration](docs/cordis-primer.md#loader-configuration). CI e2e skips without a key.

## Conventions

- **Packages:** `@deepseek-ai/dsh-<name>`; `@deepseek-ai/cordis` is peerDep; vendored packages `private: true`. [rescope.md](docs/rescope.md)
- **ESM everywhere** (`"type": "module"`); package names across packages, `.ts` in local imports. [testing.md#test-subprocess-launch-modes](docs/testing.md#test-subprocess-launch-modes)
- **Registrations are effects:** `ctx.effect()`/`ctx.on()`; `register()` returns the disposer.
- **Invariants assert owned relationships** — check event streams/mutable data, not presence. [package invariant rules](packages/AGENTS.md)
- **Typed events:** declaration merging + merge-extensible maps; `@mode`/`@param` JSDoc; `SESSION_FORMAT_VERSION` only for structural changes. [mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)
- **Switch on discriminant tags**; `assertNever` for closed unions.
- **Waterfall listeners MUST call `next()`.** [semantics](docs/cordis-primer.md#cordis-waterfall-semantics)
- **Model-visible ⟺ logged:** a model-visible input requires a session event.
- **Plugins, not loop changes;** changing `agent-loop` requires updating [docs/architecture.md](docs/architecture.md).
- **Capability seam = Service Definition / Provider / Consumer**; complete, never one role. [glossary](docs/glossary.md#capability-seam)
- **Prefer maintained deps** over hand-rolling when they delete owned code+tests. [policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)
- **Explicit > implicit at boundaries:** `resolve(request): Spec`, never hidden `?? default` in `run()`.
- **No hardcoded tunables:** deployment-varying choices are `Config` fields changeable from `cordis.yml`. Protocol constants stay fixed.
- **Misconfiguration fails loud** at load or earliest resolvable point; never silently skip.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript** at typed same-process boundaries; validate only at parser/config, JSON, durable/file, worker, process, wire.
- **Source plane ≠ artifact plane.** Static gates resolve to `src`; built-`lib` gates declare the dependency. [layout](docs/development.md#typescript-project-layout)
- **One aggregate per package** except `api/remotes`; face configs, never root solution.
- **Empty `catch` names what it swallows** and why; keep the `try` to one statement.
- **No comments on facts obvious from code.**
- **Prefer symmetry** for parallel values; asymmetry signals a missed extraction.
- **Tests describe behavior, not correctness** — change obsolete behavior with its tests; explain why in the PR.
- **Non-trivial changes MUST include an Agent Note** in the same PR; mechanical edits exempt. [scope](.agents/notes/README.md#when-to-write-one) | [archive policy](.agents/notes/README.md#archiving-and-deletion)
- **Testing policy** — [docs/testing.md](docs/testing.md). Non-trivial model/user-visible changes add a keyless snapshot via a real runnable example. [surfaces](docs/testing.md#when-a-snapshot-test-is-required)
- **Tool UI render intent is by design** (`generic`/`terminal`/`diff`); presentation methods are pure fns of `args`. [cookbook](docs/cookbook/adding-a-tool.md)
- **SDKs project the loop.** Agent-loop/session-lifecycle/`SessionEventMap` changes update TS+Python SDK expected outputs in the same PR. `pnpm run test` covers neither.
- **PR history is deliberate.** Split independent changes; fix introducing PR first. Rewrites use `--force-with-lease`, abort on remote movement. [rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)
- **Labels:** one `kind/*`, all material `area/*`, native Issue Type. [taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)
- **TODO:** `FIXME`/`TODO`/`XXX` by urgency. [semantics](docs/development.md#todo-markers)
- **Files end with exactly one trailing newline**; `git diff --cached --check` gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

`strict: true` + `noImplicitAny`; every `any` explains why narrowing is infeasible. Every module/export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns` (enforced by `verify-export-jsdoc`). Docs live at the declaring Service Definition, protocol, or class. Comments state complete contracts, not reasoning transcripts — use direct, concrete terms (no metaphors). Decisions via [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md). Wire mechanically checkable invariants into an executed gate. Full prose standard: [docs/AGENTS.md](docs/AGENTS.md).

**Docs accompany every code change** — update affected README + JSDoc together. Current-state prose: one physical line per paragraph, one home per fact. [docs/AGENTS.md](docs/AGENTS.md).

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root, `packages/`, `examples/`; edit the real file. Keep rules self-contained with links; condense when clarity survives; raise `verify-doc-budgets` ceiling only with justification.
