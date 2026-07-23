# Conduit 0.22

Conduit is a one-to-eight-pane Electron browser for repeating ordinary browsing work across isolated sessions. The main screen can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Restored low-latency scroll following through a dedicated animation-frame channel.
- Added an explicit follower handshake after Settings closes and after a pane reset.
- Added a retry and visible state to the Go button when the workspace is briefly busy.
- Simplified the pane section to names, status, Pause, and Reset.
- Removed numeric pane tiles and the Focus button from Settings.
- Renamed the default visible labels to Main screen and Follower A–G.
- Changed missing location text to `IP swapped · location unavailable` while retaining the IP address.
- Rebuilt `relay://home` as a simple Conduit alignment test with text, checkbox, options, a button, count, and scrolling.
- Kept the translucent graphite interface, four-pane startup, adjustable scale, Standard and Multiple IPs modes, sound routing, and route checks.

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
