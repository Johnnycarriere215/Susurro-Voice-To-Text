# Susurro 0.1.0 — Release Artifacts

Generated: 2026-07-19T20:41:41.487Z

| Platform | Artifact | File | Size | SHA-256 | Status |
|----------|----------|------|------|---------|--------|
| macos | macOS disk image | `Susurro-0.1.0-mac-x64.dmg` | — | — | pending |
| macos | macOS installer package | `Susurro-0.1.0-mac-x64.pkg` | — | — | pending |
| windows | Windows installer (NSIS) | `Susurro-0.1.0-win-x64.exe` | — | — | pending |
| windows | Windows installer (MSI) | `Susurro-0.1.0-win-x64.msi` | — | — | pending |
| linux | Linux AppImage | `Susurro-0.1.0-linux-x64.AppImage` | — | — | pending |
| linux | Debian/Ubuntu package | `Susurro-0.1.0-linux-x64.deb` | — | — | pending |

`url` fields in `releases.json` are intentionally blank — fill them in once
the files are uploaded to hosting. Artifacts marked *pending* must be built
on their native platform (`npm run dist:mac` / `dist:win` / `dist:linux`),
then re-run `npm run release:manifest` on a machine that has all files in `dist/`.
