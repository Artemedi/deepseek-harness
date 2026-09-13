# Deploy — systemd user service update & restart

Applies to a Harness instance running as `dsh-web.service` on this host.

## Path to the running install

| What | Where |
|---|---|
| Repo | `/var/home/Trintos/projects/deepseek-harness` |
| Global `dsh` bin | `~/.local/share/pnpm/bin/dsh` (in PATH) |
| Shim source | `scripts/dsh-global-shim` |
| Sessions/settings | `~/.dsh` (back this up before updating) |

## Update-and-restart checklist (run from repo root)

```sh
cd /var/home/Trintos/projects/deepseek-harness
# 1. Back up mutable state.
cp -a ~/.dsh ~/.dsh.bak.$(date +%Y%m%d-%H%M%S)

# 2. Install + build (frozen lockfile in production).
pnpm install --frozen-lockfile
pnpm run build

# 3. Restart the service.
systemctl --user restart dsh-web.service

# 4. Verify it came back up.
systemctl --user --no-pager --full status dsh-web.service
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/
```

**Success criteria:** service reports `active (running)` **and** the HTTP check
returns `200`. If the build fails, **do not restart the service** — roll back
the repo (`git stash`/`git checkout`) and restore from the `~/.dsh` backup.

After success: **refresh the existing `http://127.0.0.1:3081` page with
`Ctrl+Shift+R`.** Do not start a separate Vite server for the complete Web UI;
only DSH web injects `window.__DSH_BOOT__`.

## Notes

- Service runs on port 3081 here (browser UI), served behind a known-good build.
- `--no-open` is implied in the systemd unit (headless host); the unit manages launch.
