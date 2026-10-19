# Changelog

## 0.1.0 — 2026-10-19

Initial public release. **Experimental:** only tested on DeepSeek Harness Desktop 0.2.1-rc.2; published to discover whether it works in other environments.

- Live preview panel for the DeepSeek Harness Web UI, served from a loopback-only preview server.
- Run / select / adjust modes: multi-select elements, drag, resize, rotate, edit text and colors.
- Selection and pending adjustments are injected into the owning agent's context; the model resolves candidates and edits project files.
- Packaging gate for EXE/APK commands with **one confirmation per build**.
- “无需确认 / No confirm” toggle (off by default) for direct packaging, with an explicit off state that restores per-build confirmation.
- Source watcher reloads the preview and invalidates stale confirmations.
