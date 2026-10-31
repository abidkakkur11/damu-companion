# Contributing to Damu

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Getting set up

Requirements: [Node.js](https://nodejs.org/) 20 or newer and Windows 10/11.

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
| `src/main.js` | Main process: tray, windows, settings storage, reminder timers |
| `src/companion.html`, `src/companion.js` | The transparent overlay: Damu's animation, behaviour and audio |
| `src/settings.html`, `src/settings.js` | The Settings window |
| `src/preload*.js` | Secure bridges between the main process and each window |
| `assets/` | Poses, walk animation frames, faces, voice clips and icons |
| `scripts/` | Asset pipeline and packaging helpers |

## Making changes

- Run `npm run check` before committing; it syntax-checks the source files.
- Test in the real app. The overlay, tray and audio can't be verified by reading code alone.
- Keep the app private by design: no network calls, no telemetry. Changes that affect data handling must also update the Privacy Policy page in `src/settings.html`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for messages (`feat:`, `fix:`, `docs:`, `chore:`).
- Add a line to `CHANGELOG.md` for anything users will notice.

## Adding voice clips

Put `.wav` files in `assets/audio/` and list them under an event in the `SOUNDS` table at the top of `src/companion.js`.

## Releases

Maintainers: bump `version` in `package.json`, update `CHANGELOG.md`, then push a tag such as `v1.0.0`.
The release workflow builds the installer and attaches it to a GitHub release.
