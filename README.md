# Conduit 0.20

Conduit is a one-to-eight-pane Electron browser for repeating ordinary browsing work across isolated sessions. Pane 1 can lead navigation, scrolling, typing, and clicks while every pane keeps separate cookies, storage, cache, and optional route identities.

## What changed

- Settings now keeps a private draft until **Apply changes**, so live pane updates no longer reset page scale, the Isolated route choice, sound mode, or following options.
- Conduit always starts with four visible panes and an 80% page scale.
- The interface is dark-only with translucent black materials and a slanted Conduit mark.
- Added a startup screen that reports pane initialization progress while sessions open in the background.
- Added a **Go** button and reliable `⌘A` / `Ctrl+A` selection in the address field.
- The Follow Pane 1 master control selects all four following types. Clearing any individual type clears the master while the remaining types can continue working.
- Pane 1 navigation now reaches every active follower, including local `relay://home` navigation.
- Replaced the older pane list with compact pane cards showing state, IP address, approximate location, sound status, focus, pause, and reset controls.
- Added sound routing: Pane 1 only, focused pane, all visible panes, or mute every pane. Pane 1 only is the default.
- Added IP and approximate location lookup with an IP-only fallback.
- Removed saved workspace presets, automatic appearance detection, and the seven/eight-pane MacBook warning.
- Simplified `relay://home` and moved its `+1` button beside the count at the bottom.
- Kept the optional ad filter under **Privacy [BETA]**.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

## Keyboard shortcuts

- `⌘,` opens Settings.
- `⌘L` focuses and selects the address field.
- `⌘A` or `Ctrl+A` selects the complete address while the field is focused.
- `⌘R` reloads the focused pane.
- `⌘⇧R` reloads every visible pane.
- `⌘1` through `⌘8` focus a pane.

## Isolated routes

The Isolated option connects to a compatible local SOCKS service on port 9050 or 9150. Conduit does not launch that service itself. If the service is unavailable, Conduit reports the error and restores the Standard route.

Security-challenge pages are skipped. Password fields, file uploads, payment actions, purchases, voting, and account deletion remain outside synchronization.
