# Conduit 0.15

Conduit is a linked multi-pane Electron browser. Pane 1 can lead supported activity across the remaining panes, while each pane keeps an isolated browser session and can optionally use an isolated network route.

## What changed in 0.15

- Expanded the workspace from four to eight real browser panes.
- Added 3×2 and 4×2 workspace matrices for five to eight panes.
- Added an in-app performance warning because additional Electron sessions can increase memory use, battery drain, and interface lag.
- Replaced jumpy follower scrolling with continuous controller sampling and eased follower motion.
- Removed the permanent top-right linking status block and the Conduit subtitle.
- Reworked Settings around a compact mineral-glass palette with slower entrance and exit motion.
- Progress UI appears only while Conduit is applying, restarting, or resetting something.
- Renamed the session trace to the **Conduit ledger** and removed generic request/ready/connected noise.
- Ledger entries use focused signal names such as MATRIX, EGRESS, MIRROR, ADFILTER, COMMIT, and FAULT.
- Verified IP results appear as individual pane entries, with location details when the optional lookup succeeds.
- Marked the built-in ad filter as beta because filtering can interfere with some websites.

## Install on macOS

Extract the archive, open Terminal in the extracted folder, and run:

```bash
npm install --registry=https://registry.npmjs.org/ --no-package-lock
npm run check
npm start
```

After dependencies are installed, you can also double-click `Start Conduit.command`.

## Toolbar controls

- **Panes:** choose one to eight panes.
- **Zoom:** change the shared page scale.
- **Route:** switch between the standard route and isolated per-pane identities.
- **Follow pane 1:** enable or disable linked activity.
- **Ad filter:** enable or disable the beta advertising and tracker request filter.

Each change opens the progress sheet, applies the complete configuration, and returns browser access only after the operation finishes.

## Pane linking

When **Follow pane 1** is enabled, Conduit mirrors supported clicks, typing, selections, navigation, and scrolling from Pane 1 to the visible follower panes. Window scrolling is sampled continuously and followers ease toward the latest position.

CAPTCHA and security-challenge interfaces are not mirrored. Password fields, file uploads, payments, purchases, votes, account deletion, and similar sensitive actions are excluded.

## Isolated routes

The isolated route option connects to a compatible local SOCKS service on port 9050 or 9150. Conduit does not launch that service itself. Separate route identities do not guarantee different public exit addresses, so route verification remains available in Settings.
