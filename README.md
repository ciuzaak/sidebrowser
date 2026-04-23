# sidebrowser

A side-panel Electron browser with mobile emulation, persistent login, mouse-leave dim/blur, and edge auto-hide.

**Status:** In development. See `docs/superpowers/specs/2026-04-23-sidebrowser-design.md` for the full spec and `docs/superpowers/plans/` for milestone implementation plans.

## Requirements

- Node.js ≥ 20
- pnpm ≥ 9
- Windows 10/11 (v1; macOS planned for v1.5)

## Environment gotcha

If your shell has `ELECTRON_RUN_AS_NODE=1` set (some dev tools set it globally), Electron will run in Node-compat mode and the app will fail to start. All npm scripts that spawn Electron are wrapped with `node scripts/run.mjs` which strips the variable — just use the pnpm scripts and it should Just Work. If you launch `electron-vite` directly, make sure to `unset ELECTRON_RUN_AS_NODE` first.

## Development

```bash
pnpm install
pnpm dev
```

## Testing

```bash
pnpm test          # Unit tests (Vitest)
pnpm test:e2e      # End-to-end tests (Playwright for Electron) — requires pnpm build first
pnpm typecheck     # TypeScript type check
pnpm lint          # ESLint
pnpm format        # Prettier
```

## Building

```bash
pnpm build
```

Outputs to `out/`. Production installer packaging is wired in milestone M8.

## Project Structure

See `docs/superpowers/specs/2026-04-23-sidebrowser-design.md` §4.3.
