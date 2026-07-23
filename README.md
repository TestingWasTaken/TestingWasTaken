# Conduit 0.23

Conduit is a one-to-eight-pane Electron browser for repeating ordinary browsing work across isolated sessions. The main screen can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Every launch starts with a clean four-pane workspace at 80% scale.
- Removed the duplicate Done action. Settings now uses Cancel or Apply and close.
- Pane-count changes are verified and retried before the interface reports completion.
- Changing pane count in Settings creates the requested panes immediately; Cancel restores the previous count.
- Rebuilt the pane section as unclipped single rows with names, route status, Pause, and Reset.
- Removed numeric pane badges, Focus, and Show all from Settings.
- Kept the low-latency scroll channel, Go-button retry, reset recovery, and post-Settings follower handshake.
- Kept the simple `relay://welcome` alignment page and translucent graphite interface.

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
