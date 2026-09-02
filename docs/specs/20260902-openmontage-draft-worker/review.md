# OpenMontage draft sandbox review

## Evidence

- [x] Official commit `cd9f3c1f03368be87b140af494914b8ee4e3c7a4` has a valid GitHub signature; repository license is AGPL-3.0.
- [x] Docker Compose static config and Yeosonam worker contract pass.
- [x] Video policy tests pass 6/6, including three synthetic information briefs and the forbidden stock-for-hotel case.
- [x] `ko_KR-kss-medium` model LFS SHA-256 `624fd774...096e2c9`; its model card names CC-BY-NC-SA-4.0 dataset licensing, so status is `license_blocked`.

## Remaining risk

- [x] Docker daemon was not running; no image, SBOM, preflight, MP4, SRT, thumbnail, or live timing result is claimed.
- [x] Upstream requirements contain ranges, so a built image digest/SBOM review is required before accepting its dependency closure.
- [x] Real approved blogs and commercially approved Korean TTS are required before live rendering.
