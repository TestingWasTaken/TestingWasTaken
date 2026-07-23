# Conduit 0.25.1

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Fixed a race where an older Following-off health update could cancel a newly enabled Follow Screen 1 request.
- Enabling Following now keeps the requested state protected while the old and heartbeat coordinators confirm it, then runs a follower resynchronization burst.
- Added a `checkmyip` toolbar bookmark that opens `https://myip.wtf`.
- Removed the “Conduit local welcome page” footer.
- Kept the 350 ms recovery heartbeat, measured synchronization percentages, fast frame-sampled scrolling, numeric IP fallback, and every other 0.25 interface behavior unchanged.

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
