# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [3.0.0] - 2026-11-22

A second character, a character switch, and a lighter, steadier app.

### Added
- **Ramanan**, a new character with ten poses and a smooth, cross-faded walk cycle with a gentle step bounce. He is the default.
  He introduces himself in the towel-waving cheer pose with his intro voice clip, a single click shows the `looking` pose, a double-click the `angry` one, and `confused` and `laughing` are available for dialogues. His voice clips and Malayalam dialogues are included.
- A greeting can choose its picture: `"greeting": { "text": "...", "audio": "intro", "pose": "cheer" }`.
- **Character switch** in Settings > General (a card per character) and in the tray / menu-bar menu. The change is live
  and the tray icon follows the character.
- `npm run character`: builds a character from raw artwork (background removal, walk-frame alignment, faces).
- A "spin" fun move after OK. The `cheer` picture is kept for the greeting; after OK a character hops or spins in a normal pose.

### Changed
- Assets moved to `assets/characters/<id>/` (poses, anim, faces, audio, `content.json`).
- Voice clips are loaded the first time they are needed, not all at start-up, and Damu's are now small MP3s (10.7 MB of WAV became 0.7 MB). `npm run audio` does this for any character.
- A standing character renders at about 30 fps and a parked (off-screen) one at about 4 fps, instead of 60 always.
- Smaller app: maximum installer compression, unused language packs and legacy images removed, unused build tools dropped.
- Updated build tooling (electron-builder 26, sharp 0.35) and GitHub Actions versions.

### Fixed
- **Movement sometimes sped up:** the "run" fun move after OK sprinted at up to 1.9x by playing the walk faster. It is
  gone; walking speed is now constant, at any frame rate and under CPU load.
- A bubble timing out while you drag him no longer leaves him "held" with clicks falling through to other apps.
- A dialogue or switch-off that arrived during the idle animation could be lost if you clicked him; it now always runs.
- Switching him off and on again quickly no longer strands him off-screen.
- A dialogue without text no longer freezes him for three minutes.
- A damaged or hand-edited settings file (including keys like `__proto__`) can no longer stop the app starting, and settings are written atomically and debounced (sliders no longer hit the disk dozens of times a second).
- One double-click no longer disables the hover reaction for the rest of the session.
- The walk-out can take longer than 30 s at the slowest speed on a big screen; the hide timer is now 2 minutes.
- macOS: keeping him on top of full-screen apps no longer hides the Dock icon while Settings is open.
- A failed voice-clip load is retried instead of being remembered as failed.
- A second copy of the app no longer flashes windows or a second tray icon before quitting.
- The character is kept on screen when the display size changes.

### Removed
- The speed-boost "run" move, and unused assets (duplicate PNG poses, legacy faces, the old avatar script).

## [2.0.1] - 2026-11-01

### Fixed
- The documented minimum macOS version was wrong: the bundled Electron 33 needs macOS 11 (Big Sur) or newer, not 10.15.

### Added
- **Landing page:** Damu says his intro when the visitor first scrolls (or on their first click or tap, if the browser blocks sound), with a Mute / Unmute button. It plays once per visit and remembers a mute.

### Removed
- The Buy me a coffee links (README, landing page, About page, tray menu and the repository Sponsor button).

### Changed
- The author is now credited as **Abid KP** (with a link to abidkp.com) in the app, the landing page, the licence and the package metadata.

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
