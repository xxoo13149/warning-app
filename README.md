# Polymarket Weather Monitor V1

## Architecture overview
- Based on `Electron + React + TypeScript + Vite` so the renderer is a single-page dashboard while the main process owns the tray, notifications, and IPC bridges.
- A dedicated worker thread (Node `worker_threads`) handles Polymarket discovery, WebSocket subscriptions, alert rules, and SQLite persistence (`better-sqlite3 + Drizzle + Zod` semantics) so renderer code never reaches across the network or touches the database directly.
- Alerts, sounds, and configuration live locally; the app is read-only—no wallet, no trading, only market observation for the 47 daily-weather cities.

## Prerequisites
- Windows build tools (Visual Studio Build Tools or equivalent) must be installed so `better-sqlite3` can compile its native bindings. After `npm install`, run `npx electron-rebuild` if `npm start` complains about missing `.node` modules.

## Development
1. `npm install`
2. `npm run start` to launch the Electron app with HMR and the worker thread enabled.
3. `npm run lint` to catch TypeScript/ESLint issues before packaging.
4. On Windows machines that access Polymarket through a local proxy, the app now auto-detects the system proxy from Internet Settings and routes Polymarket REST/WebSocket traffic through it.

## Packaging
- `npm run package` creates a distributable Electron bundle under `D:\warning-app-artifacts\`. Use this for lightweight QA runs without polluting the repo workspace.
- `npm run make` runs the `@electron-forge/maker-squirrel` maker and produces `Setup.exe` installers (and related artifacts) under `D:\warning-app-artifacts\make`. Install that EXE to test tray behavior, background audio, and alert delivery.
- Runtime-only copied native dependencies are prepared under `D:\warning-app-runtime_node_modules\` so packaging output stays outside the repository.
- If `npm run make` needs to download tooling through a proxy, set `HTTP_PROXY` and `HTTPS_PROXY` explicitly before invoking it. Example in PowerShell: `$env:HTTP_PROXY='http://127.0.0.1:7897'; $env:HTTPS_PROXY='http://127.0.0.1:7897'; npm run make`.
- On a fresh install, enable the tray/auto-start options inside the Settings page; auto-start defaults to disabled.

## Configuration
- Drop city mappings and sound profiles via the Settings page’s import controls or place JSON files next to the application data directory and load them through the same dialog. City configs follow the schema in `docs/city-config.md`, and the example set in `tests/fixtures/city-config.example.json` matches the required `CityConfig` structure.
- Sound profiles are described in `docs/sound-config.md`, with `tests/fixtures/sound-config.example.json` showing how to register files, volumes, and loop flags for custom alert tones.

## Known limitations
- Only the 47 daily-weather Polymarket cities are tracked; other weather markets (rain, snow, miscellaneous tags) are intentionally excluded in V1.
- The app is read-only, so no wallet/transaction support is provided and alerts cannot trigger orders or hedge actions.
- Alert delivery depends on the worker thread maintaining WebSocket connectivity; the UI cannot exert control if the worker crashes, so monitor the tray icon for reconnection status.

## Fixtures & validation
- Run `node tests/fixtures/validate-config.js tests/fixtures/city-config.example.json` (and repeat with the sound config) to verify each entry defines every required property and that numeric fields look sane. This script avoids the GUI entirely and ensures the JSON can safely be reloaded by the worker layer.

## Notes
- Store the active alert rules, sound profiles, and city config in SQLite so hot updates survive restarts; the fixtures here are meant to seed that storage via the import workflow described above.
- Keep the renderer focused on Dashboard/Market Explorer/Alert Center while the worker handles discovery, WebSocket reconnections, and alert deduplication.
