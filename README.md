# Conduit 0.19

Conduit is a one-to-eight-pane Electron browser for repeating ordinary browsing work across isolated sessions. Pane 1 can lead navigation, scrolling, typing, and clicks while followers keep separate cookies, storage, cache, and optional route identities.

## What changed

- Restored the translucent white-and-black Mac utility palette with a restrained blue accent.
- Appearance is now an explicit Light or Dark choice. Conduit no longer follows or guesses the device appearance.
- Replaced the Settings close symbol with a plain **Done** button.
- Moved pane focus, pause, rename, and reset controls into the normal Settings flow instead of a right-side dashboard.
- Marked Privacy as **[BETA]**.
- Added `relay://home` as the visible local address while keeping `relay://welcome` as a compatibility alias for old saved workspaces.
- Rebuilt the local home page as a plain synchronization test with text, a checkbox, a menu, a button, and a scroll area.
- Kept the Conduit 0.18 synchronization coordinator, eight-pane support, saved workspaces, session restore, selective following, ad filter, and route controls.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

After dependencies are installed, `Start Conduit.command` can also be used.

## Keyboard shortcuts

- `⌘,` opens Settings.
- `⌘L` focuses the address bar.
- `⌘R` reloads the focused pane.
- `⌘⇧R` reloads every visible pane.
- `⌘1` through `⌘8` focus a pane.
- `⌘⇧S` saves a workspace preset.

## Pane following

Pane 1 is the leader. Followers can be paused individually without closing their sessions. Settings can independently enable or disable navigation, scrolling, typing, and click following.

Security-challenge pages are skipped. Sensitive fields and actions are not mirrored.

## Isolated routes

The isolated route option connects to a compatible local SOCKS service on port 9050 or 9150. Conduit does not launch that service itself. Route verification reports the public IP address visible to each active pane.
