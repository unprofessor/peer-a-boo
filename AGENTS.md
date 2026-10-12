# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-05
**Commit:** 1de92f4
**Branch:** main

## OVERVIEW

P2P baby monitor web app using WebRTC (PeerJS) with Vite + TypeScript. Two modes: Baby Station (streams camera/mic) and Parent Station (receives stream).

## STRUCTURE

```
peer-a-boo/
├── src/                  # All application source
│   ├── main.ts           # Entry: routing, URL state, landing page
│   ├── baby-station.ts   # Camera/mic streaming, QR code, settings drawer
│   ├── parent-station.ts # Receives stream, audio/motion meters, alerts
│   ├── motion-detection.ts # Frame differencing motion detector
│   ├── utils.ts          # Wake lock, media helpers, audio meter
│   ├── style.css         # Global styles, CSS custom properties, dark theme
│   ├── dictionary.ts     # Random room ID word generator
│   └── *.test.ts         # Colocated tests (Vitest)
├── tests/                # Playwright e2e tests (excluded from Vitest)
├── scripts/              # Dev cert generation
├── certs/                # Self-signed TLS certs (dev only, gitignored keys)
└── public/               # Static assets
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Modify camera/mic handling | `src/baby-station.ts` | Device selection, stream management |
| Modify video display | `src/parent-station.ts` | Audio meter, motion detection, reconnection logic |
| Add shared utilities | `src/utils.ts` | Wake lock, media stream helpers |
| Motion detection | `src/motion-detection.ts` | Frame differencing, grayscale conversion, threshold |
| Change room ID format | `src/dictionary.ts` | Word list + ID generator |
| Modify routing/state | `src/main.ts` | URL params, history API |
| Fix build/deploy | `vite.config.ts`, `.github/workflows/deploy.yml` | |

## CONVENTIONS

- **Module structure**: Each station is self-contained with `init*` function returning `CleanupHandle`
- **Cleanup pattern**: All stations MUST return `{ cleanup: () => void }` for proper teardown
- **Tests**: Colocated (`*.test.ts` next to source), use Vitest globals
- **Error handling**: Use `querySelectorOrThrow()` - never silently fail on missing DOM
- **URL state**: Stations sync state via URL params (`station`, `roomId`)
- **Wake Lock**: Always request on station init, release in cleanup

## ANTI-PATTERNS (THIS PROJECT)

- Never leave MediaStream tracks running after cleanup
- Never use `querySelector` without null check (use `querySelectorOrThrow`)
- Don't hardcode PeerJS peer IDs in parent station (random ID, call by room)

## UNIQUE STYLES

- Room IDs: `WordWordWord1234` format (dictionary.ts)
- HTTPS dev mode: `bun run dev:https` generates self-signed certs
- No separate vitest.config - test config embedded in `vite.config.ts`
- **UI Pattern**: Full-screen video with slide-up settings drawers (`.settings-drawer`)
- **CSS Architecture**: CSS custom properties in `:root`, dark theme default
- **Alerts**: Non-disruptive toast notifications (`.toast`) + video border glow (`.video-alert`)

## COMMANDS

```bash
bun run dev          # HTTP dev server
bun run dev:https    # HTTPS dev server (for LAN/mobile testing)
bun run build        # vitest run + tsc + vite build
bun run test -- --run  # vitest (no watch mode - prevents bash timeout)
bun run preview      # Preview production build
bun run signal       # Local PeerJS signaling server on :9000 (set VITE_PEER_HOST/PORT)
```

## NOTES

- **Package manager**: Uses Bun for faster installs and script execution
- **Mobile testing requires HTTPS**: Use `bun run dev:https -- --host 0.0.0.0`
- **PeerJS retry timing**: Parent station waits 5s+ between retries (PeerJS connection timeout)
- **Back camera default**: Baby station prefers `facingMode: environment` on mobile
- **Audio meter scaling**: RMS value scaled 3x for visibility (`level * 3`)
- **Motion detection**: Frame differencing on 160x120 downsampled video, 2-second alert cooldown
- **Test timeout fix**: Always use `bun test -- --run` to disable watch mode (prevents agent bash timeout)
- **Test separation**: Vitest runs `src/*.test.ts` only; Playwright tests in `tests/` are excluded via `vite.config.ts`
