# City configuration reference

This file documents the JSON shape used by the `CityConfig` import step so the worker thread knows which Polymarket series to track for every airport.

## Schema

- `cityKey` – unique short id used in alerts and dashboards (e.g., `nyc`, `chi`, `sfo`).
- `displayName` – user-facing label such as `New York City Daily Weather`.
- `seriesSlug` – the Polymarket series slug that matches `*-daily-weather` events for that city.
- `airportCode` – IATA code representing the associated airport (used for referencing sound alert context or resolution overrides).
- `timezone` – timezone identifier (e.g., `America/New_York`) that the worker uses to normalize event timestamps.
- `enabled` – boolean flag to toggle tracking without removing the config entry.
- `resolutionSourceOverride` – optional string binding the event resolution to a data feed (if Polymarket’s default resolutionSource does not uniquely resolve the airport, supply your preferred label here).

## Importing

1. Drop your JSON file into the Settings > City Config import dialog.
2. The worker loads the new entries, reconciles against the 47-city list, and persists them in the local SQLite store.
3. Any entry marked `enabled: false` stays dormant until you toggle it on via the UI; the worker still fetches metadata but skips subscriptions.

Refer to `tests/fixtures/city-config.example.json` for a ready-to-use sample that matches this schema.
