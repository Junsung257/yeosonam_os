# OpenMontage draft sandbox

This directory wraps the immutable official `calesthio/OpenMontage` commit recorded in `config/openmontage-worker.json`. It does not vendor or modify upstream, install its Skills into Codex, expose a network service, or connect to Yeosonam databases and publishing APIs.

The official project is agent-first and does not currently ship a Docker runtime. This image is therefore a restricted tool sandbox, not a claim of upstream Docker support or a production worker. Its dependency install remains a build-time prototype until an image digest/SBOM is captured and approved.

Runtime defaults are a read-only root filesystem, no network, read-only `/input`, private/gitignored `/output`, no ports, no secrets, no paid providers, and no Korean voice model. The known `ko_KR-kss-medium` Piper voice is deliberately blocked because its model card identifies a CC-BY-NC-SA-4.0 dataset.

When Docker Desktop is running, create the two private mount directories and run:

```bash
docker compose -f tools/openmontage-worker/compose.yaml build --pull
docker compose -f tools/openmontage-worker/compose.yaml run --rm openmontage preflight
```

Do not render until an approved blog revision, evidence hash, source manifest, and commercially approved Korean voice are present. A render stays `draft_pending_va`; this prototype has no upload, social publish, or database-write path.
