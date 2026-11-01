# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-11-01

Damu is no longer a water-and-break reminder. He now drops by with dialogues of your own.

### Added
- **Dialogues:** every so often Damu comes to you, shows a speech bubble and plays that dialogue's
  voice clip. When you press **OK** another clip plays and he does a fun move (cheer or run).
- **`assets/content.json`:** one file with all dialogue text and audio, the OK button label and
  clip, and clips for every mouse reaction (click, double-click, drag start, drop, hover).
- **macOS support:** a menu-bar app with a universal `.dmg` build, built on macOS runners in CI.
- **Goodbye:** switching Damu off plays a goodbye clip (`goodbye` in `content.json`) as he walks away.
- **Malayalam text:** speech bubbles use the bundled Noto Sans Malayalam font (SIL OFL) with room for stacked letters.
- **Support links:** a Support section in About and a tray item for Buy me a coffee.
- **Landing page** (`site/`) published with GitHub Pages, with direct download links and a live download count.
- Contributor files: Code of Conduct, Security policy, issue and PR templates, Dependabot, funding link.
- Settings: dialogue on/off and visit interval, separate sound switches for
  dialogues and mouse reactions, "Dialogue now" button.

### Changed
- Walking, animations and idle times are faster (default walking speed 1.3x).
- The Settings window, About and Privacy Policy now describe dialogues instead of reminders.
- "Start with Windows" is now "Start at login" (works on Windows and macOS).
- Installers are named `Damu-Setup-<version>.exe` and `Damu-<version>-mac-universal.dmg`.

### Fixed
- **Say hi** now uses the greeting from `content.json` instead of hardcoded English, and **Dialogue now** works while dialogues are switched off or another dialogue is still open.

### Removed
- Water and break reminders and random chatter, with their settings.

## [1.0.0] - 2026-10-31

### Added
- Settings window with General, Reminders, Companion, Audio, About and Privacy Policy pages.
- Controls for reminders, walking speed, size, off-screen trips, audio and show/hide, saved instantly.
- Voice clips: `.wav` files in `assets/audio/` play at random per event.
- Windows installer (NSIS) and unpacked build via `npm run dist` / `npm run pack`.
- Graceful walk-out and walk-in when the companion is switched off and on, and on launch.
- Continuous integration and a tag-triggered release workflow.

### Fixed
- Damu getting stuck at the screen edge instead of leaving the screen during an off-screen trip.
- Reminders arriving while Damu was away being dropped and leaving him frozen.
- Damu stopping abruptly on arrival; he now slows to a stop.

## [0.1.0]

- Initial release: animated companion with water and break reminders, speech bubbles and tray controls.

[2.0.0]: https://github.com/abidkakkur11/damu-companion/releases/tag/v2.0.0
[1.0.0]: https://github.com/abidkakkur11/damu-companion/releases/tag/v1.0.0
