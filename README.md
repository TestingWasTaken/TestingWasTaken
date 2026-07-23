# Conduit 0.26

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Replaced the overlapping v18, v22, v24, and v25 synchronization paths with one authoritative v26 coordinator.
- Every browser screen now uses one v26 preload contract for registration, navigation, scroll, controls, snapshots, and health acknowledgements.
- Follow Screen 1 now has one source of truth for enabled state, policy, paused screens, and visible screen count.
- URL changes, frame-sampled scrolling, clicks, typing, checkboxes, menus, and safe form controls all use the same coordinator.
- Resetting a screen or closing Settings runs the same full resynchronization path.
- The numeric IP fallback now registers through the v26 pane channels.
- Kept the existing translucent interface, clean four-screen start, 80% scale, checkmyip bookmark, and welcome page.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

After dependencies are installed, `Start Conduit.command` can also be used.

## Shortcuts

- `⌘,` opens Settings.
- `⌘L` focuses the address bar.
- `⌘A` selects the full address while the address bar is focused.
- `⌘R` reloads the active screen.
- `⌘⇧R` reloads every visible screen.

## Connection modes

**Standard** uses the Mac's normal connection. A device-wide VPN can be used with Standard, but every screen normally receives the same VPN exit IP.

**Multiple IPs** currently uses the local private-route service. A faster future replacement is a user-supplied HTTP or SOCKS proxy pool, with one proxy assigned to each Electron session.

## Safety

Security-challenge pages are skipped. Password, file-upload, payment, purchase, voting, and account-deletion actions are not mirrored.
