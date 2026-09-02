FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7

ARG OPENMONTAGE_COMMIT=cd9f3c1f03368be87b140af494914b8ee4e3c7a4
ENV DEBIAN_FRONTEND=noninteractive \
    OPENMONTAGE_COMMIT=${OPENMONTAGE_COMMIT} \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg git nodejs npm \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --filter=blob:none https://github.com/calesthio/OpenMontage.git /opt/openmontage \
    && git -C /opt/openmontage checkout --detach "${OPENMONTAGE_COMMIT}" \
    && test "$(git -C /opt/openmontage rev-parse HEAD)" = "${OPENMONTAGE_COMMIT}"

RUN python -m pip install --no-cache-dir -r /opt/openmontage/requirements.txt piper-tts \
    && npm --prefix /opt/openmontage/remotion-composer ci --omit=dev

COPY entrypoint.sh /usr/local/bin/yeosonam-openmontage
RUN chmod 0755 /usr/local/bin/yeosonam-openmontage \
    && useradd --create-home --uid 10001 worker \
    && mkdir -p /input /output /work \
    && chown -R worker:worker /output /work

USER worker
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/yeosonam-openmontage"]
CMD ["preflight"]
