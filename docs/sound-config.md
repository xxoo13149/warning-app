# Sound profile configuration

Sound profiles describe which WAV/MP3 samples run when alerts fire and how loud each tone should be. This keeps the renderer thin while the main process handles raw audio playback through a hidden window.

## Schema

- `id` – stable identifier referenced by alert rules (`soundProfileId` in the alert rule contract).
- `name` – human-readable label shown beside the sound selector.
- `filePath` – relative path under the application bundle or absolute filesystem path to the audio file.
- `volume` – float between `0` (muted) and `1` (full volume).
- `loop` – boolean that determines whether the sample repeats until the alert is acknowledged.
- `description` – optional detail for your own reference.

## Usage

1. Save your JSON to a convenient location and import it through Settings > Sound profiles.
2. Attach the imported `soundProfileId` to rules that should trigger that tone.
3. After import, the main process keeps the files cached so background playback works even when the renderer window is closed.

Use `tests/fixtures/sound-config.example.json` as a starting point when building new alert rhythms.
