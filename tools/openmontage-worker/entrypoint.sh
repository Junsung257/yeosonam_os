#!/bin/sh
set -eu

case "${1:-preflight}" in
  preflight)
    test "$(git -C /opt/openmontage rev-parse HEAD)" = "${OPENMONTAGE_COMMIT}"
    test -r /input
    test -w /output
    python --version
    node --version
    ffmpeg -version | sed -n '1p'
    piper --help >/dev/null
    printf '%s\n' "OpenMontage sandbox ready at ${OPENMONTAGE_COMMIT}; no Korean voice or production input is bundled."
    ;;
  shell)
    exec /bin/sh
    ;;
  *)
    exec "$@"
    ;;
esac
