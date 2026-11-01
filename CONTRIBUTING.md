# Contributing to Damu

Thanks for your interest in making Damu better! Bug reports, ideas, dialogues, translations, animations and pull
requests are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug or suggest a feature:** open an [issue](https://github.com/abidkakkur11/damu-companion/issues/new/choose).
- **Ask a question or share an idea:** use [Discussions](https://github.com/abidkakkur11/damu-companion/discussions).
- **Test on macOS or other Windows versions:** tell us what worked and what didn't.
- **Pick up an issue:** look for [`good first issue`](https://github.com/abidkakkur11/damu-companion/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/abidkakkur11/damu-companion/labels/help%20wanted). Comment first so work isn't duplicated.
- **Improve the docs or the landing page** (`site/`).

## Getting set up

Requirements: [Node.js](https://nodejs.org/) 20 or newer, on Windows 10/11 or macOS.

```bash
git clone https://github.com/abidkakkur11/damu-companion.git
cd damu-companion
npm install
npm start
```

If the app crashes on launch with `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`,
unset the `ELECTRON_RUN_AS_NODE` environment variable.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.js` | Main process: tray, windows, settings storage, visit timer |
| `src/companion.html`, `src/companion.js` | The transparent overlay: Damu's animation, behaviour, dialogues and audio |
| `src/settings.html`, `src/settings.js` | The Settings window |
| `src/preload*.js` | Secure bridges between the main process and each window |
| `assets/content.json` | All dialogue text, OK/goodbye audio and mouse-reaction audio |
| `assets/` | Poses, animation frames, faces, fonts, voice clips and icons |
| `scripts/` | Asset pipeline and packaging helpers |
| `site/` | The landing page (GitHub Pages) |

## Making changes

1. Fork the repo and create a branch: `git checkout -b feat/my-change`.
2. Make your change. Keep it focused; one idea per pull request.
3. Run `npm run check` (syntax check) and try the change in the real app with `npm start`.
   The overlay, tray and audio can't be verified by reading code alone.
4. Update `CHANGELOG.md` under **Unreleased** for anything users will notice.
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
6. Open a pull request and fill in the template. CI builds the app on Windows and macOS.

Guidelines:

- Keep the app private by design: no network calls, no telemetry. Anything that affects data handling must also
  update the Privacy Policy in `src/settings.html`.
- Settings are validated in `src/main.js` (`DEFAULTS` and `RANGES`); a new setting needs its default there, a control
  in `src/settings.html` with a `data-key`, and a reader in `src/companion.js` via `cfg`.
- Match the surrounding code style (see `.editorconfig`).

## Dialogues and voice clips

Put `.wav` or `.mp3` files in `assets/audio/` and reference them by name (no extension) in `assets/content.json`.
See the README for the file format.

Please only contribute artwork or audio you made or have the right to share. Media files are not covered by the
MIT license (see the README).

## Releases

Maintainers: bump `version` in `package.json`, update `CHANGELOG.md`, then push a tag such as `v2.0.0`.
The release workflow builds the Windows installer and the macOS disk image and attaches both to a GitHub release.
The macOS build can only run on macOS, so it is not buildable locally on Windows.
