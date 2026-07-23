# Conduit 0.21

Conduit is a one-to-eight-pane Electron browser for repeating ordinary browsing work across isolated sessions. Pane 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Restored the older paper-style `relay://home` page and added the Conduit mark.
- Lightened the dark interface into a translucent graphite-glass palette.
- Kept the Conduit wordmark upright rather than italic.
- Added a startup screen that waits for the four initial panes, then opens Settings automatically.
- Added a dedicated connection screen for Standard and Multiple IPs route changes.
- Renamed connection modes to Standard and Multiple IPs.
- Added a ten-second location-provider timeout with a second provider and an IP-only fallback.
- Rebuilt pane reset so the browser view is recreated and re-registers with the following coordinator.
- Added lazy pane creation: only four panes start at launch; panes 5–8 are created when selected.
- Throttled pane-health rendering and reduced registration chatter.
- Kept adjustable scale, Pane 1 following, sound routing, IP/location details, and per-pane reset/focus/pause controls.

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
- `⌘R` reloads the focused pane.
- `⌘⇧R` reloads every visible pane.
- `⌘1` through `⌘8` focus a pane.

## Connection modes

**Standard** uses the Mac's normal connection.

**Multiple IPs** connects each visible pane through a compatible local private-route service. If that service is unavailable, Conduit restores Standard and keeps Settings open with the error.

## Safety

Security-challenge pages are skipped. Password, file-upload, payment, purchase, voting, and account-deletion actions are not mirrored.
