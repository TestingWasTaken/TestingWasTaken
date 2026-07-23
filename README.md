# Conduit 0.24

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Settings now keeps pane count, scale, sound, route, and following choices as a draft until Apply and close.
- Turning Follow Screen 1 or Scrolling off clears old follower scroll targets so every screen can scroll independently again.
- Default follower names are Follower 1 through Follower 7.
- The main screen says Screen 1 leads instead of Leader.
- Audible screens show Sound enabled.
- Follower status shows the IP address beside Aligned, Connected, or Paused.
- Removed the old Use this page sentence and rebuilt `relay://welcome` with a visible result line for text, checkbox, option, button, count, and scroll testing.
- Refined the Settings background into a lighter transparent glass surface with simpler section separators.
- Kept the clean four-screen launch, 80% scale, address retry, low-latency scrolling, reset recovery, and post-Settings resynchronization.

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

**Standard** uses the Mac's normal connection.

**Multiple IPs** connects each visible screen through a compatible local private-route service. If that service is unavailable, Conduit restores Standard and keeps Settings open with the error.

## Safety

Security-challenge pages are skipped. Password, file-upload, payment, purchase, voting, and account-deletion actions are not mirrored.
