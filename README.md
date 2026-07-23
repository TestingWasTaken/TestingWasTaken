# Conduit 0.14

Conduit is a linked multi-pane Electron browser. Pane 1 can lead supported activity across the remaining panes, while each pane keeps an isolated browser session and can optionally use an isolated network route.

## What changed in 0.14

- Renamed the application from Relay to **Conduit**.
- Replaced the static toolbar summary with live controls for pane count, page scale, routing, pane linking, and request filtering.
- Toolbar changes use the same locked apply workflow as the full settings sheet.
- Rebuilt Settings as a compact translucent macOS-style sheet.
- Removed the large controller explanation and routing-install paragraph from the interface.
- Replaced the generic connection console with a compact session trace.
- Trace rows include short event hashes and concrete layout, route, verification, filter, and linking results.
- Preserved the synchronization, reset, routing, and bounded-memory bridge behavior from the 0.12 engine.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

After dependencies are installed, you can also double-click `Start Conduit.command`.

## Toolbar controls

- **Panes:** choose one to four panes.
- **Zoom:** change the shared page scale.
- **Route:** switch between the standard route and isolated per-pane identities.
- **Follow pane 1:** enable or disable linked activity.
- **Filter:** enable or disable the built-in advertising and tracker request filter.

Each change opens the progress sheet, applies the complete configuration, and returns browser access only after the operation finishes.

## Pane linking

When **Follow pane 1** is enabled, Conduit mirrors supported clicks, typing, selections, navigation, and proportional scrolling from Pane 1 to the visible follower panes.

CAPTCHA and security-challenge interfaces are not mirrored. Password fields, file uploads, payments, purchases, votes, account deletion, and similar sensitive actions are excluded.

## Isolated routes

The isolated route option connects to a compatible local SOCKS service on port 9050 or 9150. Conduit does not launch that service itself. Separate route identities do not guarantee different public exit addresses, so route verification remains available in Settings.
