# Brainclip for Brave

Brainclip is a Manifest V3 Chromium extension that captures browser material into the TimeBlock Second Brain. Brave can load it directly without a build step.

## What it captures

- Copied selected text automatically (enabled by default)
- The current selection or page from the popup
- Pages, selections, and links from Brave's context menu
- Quick thoughts typed into the popup
- The current page with `Alt+Shift+S`

Every capture becomes a standalone Markdown note under `Inbox/Web/YYYY-MM-DD/`. Notes include source metadata and are immediately indexed by the existing Second Brain API. When TimeBlock is offline, up to 100 captures are kept in extension storage and retried every minute.

Password fields are ignored. Add sensitive hostnames to the exclusion list on the extension's settings page, or pause automatic copy capture from the popup.

## Install in Brave

1. Start TimeBlock. Its local server normally runs at `http://127.0.0.1:4141`.
2. Open `brave://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this `apps/extension` folder.
5. Pin **Brainclip** from Brave's extensions menu.

Use the gear in the popup to change the local server port, capture folder, site exclusions, or maximum clip size.

## Development checks

From the repository root:

```sh
npm -w @timeblock/extension run check
npm -w @timeblock/extension test
```
