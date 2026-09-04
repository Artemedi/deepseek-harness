# Build, packages, workspace, and launch

## Workspace

- Manager: **pnpm workspaces**. Root `pnpm-workspace.yaml` lists `packages/<group>/<pkg>`, `examples/`, `python/`, `native/`, `bundle/*`.
- Package naming: every npm package is `@deepseek-ai/dsh-<name>`. Vendored packages are rescoped (see `docs/rescope.md`) and `private: true`.
- Runtime: `@deepseek-ai/cordis` is a `peerDependency` (+ dev) of every harness package.
- **ESM everywhere** (`"type": "module"`). Use package names across packages and `.ts` in local relative imports.
- Node engine: `^22.19 || >=24`.

## Core commands

```sh
pnpm install                 # install workspace deps (cache ~/.pnpm/store)
pnpm run clean               # remove build outputs + safe residue from deleted packages
pnpm run build               # tsc emits lib/types; tsdown bundles runtime
pnpm run test                # vitest unit tests
pnpm run test:coverage       # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run typecheck           # repo-wide type check
pnpm run lint
pnpm run duplication         # cross-file TypeScript clone detection
pnpm run hygiene             # knip + publint + workspace constraints + NodeNext consumer check
pnpm run doc-sync            # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run website:build        # VitePress build (doubles as dead-link check)
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine)
```

## Source vs artifact plane

- Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree.
- Gates consuming built `lib/` declare that dependency explicitly.
- Each package uses one aggregate `tsconfig.json` except `api/remotes`; repo-wide programs seed a face config, never the root solution (`docs/development.md#typescript-project-layout`).

## Launching

```sh
# From a repository checkout (source launch via tsx ESM hook):
pnpm dsh web                # UI on http://127.0.0.1:3080, opens browser
pnpm dsh web --no-open      # source launch, no browser
pnpm dsh web --port 8080
pnpm dsh --profile headless "task"   # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:cordis        # agent modifies its own runtime (needs key)
pnpm run demo:acp           # ACP automation server (needs DEEPSEEK_API_KEY)
```

- The `dsh` CLI source launch runs through `node --import tsx/esm`; modules it reaches must stay ESM. Node's native TypeScript modes are unavailable across the engine range. See `.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md`.
- `dsh web` source launch builds the Vite shell. **Do not start a separate Vite server for the full Web UI.** The web entry builds the shell but is not standalone because only DSH web injects `window.__DSH_BOOT__`. If a replacement web server is needed, use a managed background job and verify its exact URL.

## Local install (from `LOCAL-SETUP.md`)

| What | Where |
|---|---|
| Repo checkout | `~/projects/deepseek-harness` |
| Global `dsh` bin | `~/.local/share/pnpm/bin/dsh` (already in PATH) |
| Shim source | `scripts/dsh-global-shim` |
| Sessions/settings data | `~/.dsh` |

Global launch: `dsh web` (runs built `apps/cli/lib/bin.js`); version `pnpm dsh --version` (current `0.1.1-rc.2`).

## cordis.yml composition

- Plugin config allows `!!js` (never `!js`) under the `config` and `disabled` entry keys; other metadata stays literal. Conditional composition uses overlays (`docs/cordis-primer.md#loader-configuration`).
- Raw/Web `cordis.yml` bare plugins must appear in the resolver manifest's `dependencies`; `verify-cordis-config` enforces this.

## Vendoring

- `vendor/` packages are pinned source copies. Manifest with upstream SHAs in `vendor/README.md`. Update via the sync procedure there, re-apply or retire local modifications, then rerun `pnpm run test && pnpm run build`.

## Secrets

- Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. Never commit credentials. CI e2e skips without a key (`docs/testing.md` owns key policy).
