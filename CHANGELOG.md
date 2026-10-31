# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-31

### Added
- Settings window with General, Reminders, Companion, Audio, About and Privacy Policy pages.
- Controls for water and break reminders (on/off, 1-180 minute intervals), chatter frequency,
  walking speed, size, off-screen trips, audio (master switch, volume, per-event toggles),
  show/hide companion and start with Windows. Changes apply instantly and are saved.
- Voice clips: `.wav` files in `assets/audio/` play at random per event
  (launch, reminders, clicks, returning from a trip, chatter).
- Windows installer (NSIS) and unpacked build via `npm run dist` / `npm run pack`.
- Graceful walk-out and walk-in when the companion is switched off and on, and on launch.
- Continuous integration and a tag-triggered release workflow.

### Fixed
- Damu getting stuck at the screen edge instead of leaving the screen during an off-screen trip.
- Reminders arriving while Damu was away being dropped and leaving him frozen.
- Damu stopping abruptly on arrival; he now slows to a stop.

### Changed
- The tray menu is trimmed to quick actions; detailed options moved into Settings.
- Clicking the tray icon opens Settings instead of toggling visibility.

## [0.1.0]

- Initial release: animated companion with water and break reminders, speech bubbles and tray controls.

[1.0.0]: https://github.com/abidkakkur11/damu-companion/releases/tag/v1.0.0
