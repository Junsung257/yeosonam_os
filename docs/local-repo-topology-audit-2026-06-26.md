# Local Repo Topology Audit - 2026-06-26

This note records the currently verified local paths so agents do not accidentally treat separate clones or backups as a single workspace.

## Canonical Working Copy

- `C:\dev\yeosonam-os`
- This is the active Git repository used as the canonical working tree.
- The local `main` branch is aligned with `origin/main` at `d1188292` (`Fix Guangzhou transport variant catalog split (#423)`).
- `git worktree list` shows only this canonical working tree.
- The previously separate Guangzhou transport split work is already represented in `origin/main`.
- Use this folder for active development.

## Other Local Copies

- `C:\Users\admin\Desktop\여소남OS`
  - Outer container folder only, not the canonical Git repository root.
- `C:\Users\admin\Desktop\여소남OS\audit-yeosonam-os`
  - Separate Git clone of the same remote.
  - It previously contained `codex/guangzhou-transport-variant-split` at `2571598f69f5a48a14625b4cdfd0315005ec1a58`.
  - That work is now present in the canonical working tree through `origin/main`.
  - Do not use this clone for ongoing development.
- `C:\Users\admin\AppData\Local\Temp\codex-clipboard-4220ca40-c87f-48e1-9cb0-8746fd67b70c.png`
  - Temporary screenshot file only.
  - Not part of either repo.

## Cleanup Decision

- `C:\dev\yeosonam-os-migration-backup-20260615-101036` was moved into `C:\dev\yeosonam-os\.tmp\local-repo-consolidation-20260626`.
- `C:\dev\yeosonam-os-migration-backup-20260615-101446` was moved into `C:\dev\yeosonam-os\.tmp\local-repo-consolidation-20260626`.
- `C:\Users\admin\Desktop\여소남OS\audit-yeosonam-os` still exists as a separate clone. Close tools pointed at that folder before moving or deleting it.

## Next Safe Actions

1. Keep all development in `C:\dev\yeosonam-os`.
2. Do not start or edit from the desktop `audit-yeosonam-os` clone.
3. After closing any process that locks the desktop clone, move or delete it because its unique development work has already been consolidated into `origin/main`.
