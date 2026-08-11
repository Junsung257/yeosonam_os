# rhwp runtime

The V4 HWP adapter uses the pinned `rhwp` v0.8.2 release. Binaries are platform-specific and intentionally are not committed with the application:

- Windows x86_64: `windows-x86_64.zip`
- Linux x86_64: `linux-x86_64.tar.gz`
- macOS x86_64: `macos-x86_64.tar.gz`
- macOS arm64: `macos-aarch64.tar.gz`

Run `npm run install:rhwp` on the deployment/worker host. The installer downloads the official release, verifies `SHA256SUMS.txt`, and places the binary under `vendor/rhwp/0.8.2/`. Set `RHWP_BIN` or `RHWP_PATH` explicitly in production; the adapter never silently falls back to a different parser.
