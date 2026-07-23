# Conduit 0.25

Conduit is a one-to-eight-screen Electron browser for repeating ordinary browsing work across isolated sessions. Screen 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Added a 350 ms Screen 1 heartbeat that repairs missed URL, scroll, and safe form-control updates.
- Replayed clicks and inputs now receive a result; failed target matching gets one safe retry.
- Followers report a measured synchronization percentage based on URL, scroll distance, and matched controls.
- The Screens section shows per-screen percentages and an average instead of only saying Aligned.
- Fast animation-frame scrolling remains the primary path; the heartbeat is a recovery layer rather than a replacement.
- Turning Follow Screen 1 or Scrolling off still clears old follower scroll targets immediately.
- When location lookup fails but an IP was found, Conduit displays `IP address · <number>`.
- Settings continues to keep screen count, scale, sound, route, and following choices as a draft until Apply and close.
- Kept the clean four-screen launch, 80% scale, reset recovery, transparent Settings surface, and alignment test.

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
