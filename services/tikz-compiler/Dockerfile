FROM node:22-bookworm-slim AS service-deps

WORKDIR /app
COPY services/tikz-compiler/package.json services/tikz-compiler/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts


FROM node:22-bookworm-slim AS api

RUN apt-get update \
    && apt-get install --yes --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin compiler

WORKDIR /app
COPY --from=service-deps /app/node_modules ./node_modules
COPY --chown=compiler:compiler \
  services/tikz-compiler/server.mjs \
  services/tikz-compiler/compiler-core.mjs \
  services/tikz-compiler/job-store.mjs \
  services/tikz-compiler/artifact-store.mjs \
  services/tikz-compiler/provenance.mjs \
  lib/tikz/syntax/exact-profile.json \
  lib/tikz/syntax/luatex-graphdrawing-profile.json \
  ./
RUN node -e "import('./compiler-core.mjs')"

USER compiler
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]


FROM api AS api-graphdrawing

ENV TIKZ_COMPILER_PROFILE=tikz-luatex-graphdrawing-v1
RUN node -e "import('./compiler-core.mjs')"


FROM node:22-bookworm-slim AS worker

ARG TECTONIC_VERSION=0.17.0
ARG TARGETARCH=amd64
ARG TECTONIC_SHA256_AMD64=8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7
ARG TECTONIC_SHA256_ARM64=b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl dvisvgm fontconfig fonts-noto-cjk tini \
    && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) TECTONIC_TARGET="x86_64-unknown-linux-musl"; TECTONIC_SHA256="${TECTONIC_SHA256_AMD64}" ;; \
      arm64) TECTONIC_TARGET="aarch64-unknown-linux-musl"; TECTONIC_SHA256="${TECTONIC_SHA256_ARM64}" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl --fail --location --silent --show-error \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${TECTONIC_TARGET}.tar.gz" \
      --output /tmp/tectonic.tar.gz \
    && echo "${TECTONIC_SHA256}  /tmp/tectonic.tar.gz" | sha256sum --check --strict \
    && tar --extract --gzip --file /tmp/tectonic.tar.gz --directory /usr/local/bin tectonic \
    && chmod 0755 /usr/local/bin/tectonic \
    && rm /tmp/tectonic.tar.gz

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin compiler

WORKDIR /app
COPY --from=service-deps /app/node_modules ./node_modules
COPY --chown=compiler:compiler \
  services/tikz-compiler/worker.mjs \
  services/tikz-compiler/compiler-core.mjs \
  services/tikz-compiler/job-store.mjs \
  services/tikz-compiler/artifact-store.mjs \
  services/tikz-compiler/provenance.mjs \
  lib/tikz/syntax/exact-profile.json \
  lib/tikz/syntax/luatex-graphdrawing-profile.json \
  ./
RUN node -e "import('./compiler-core.mjs')"
COPY --chown=compiler:compiler services/tikz-compiler/warmup.tex /tmp/warmup.tex

ENV HOME=/home/compiler
ENV XDG_CACHE_HOME=/home/compiler/.cache
USER compiler
RUN mkdir -p /tmp/tectonic-warm \
    && tectonic -X compile /tmp/warmup.tex \
      --outdir /tmp/tectonic-warm \
      --outfmt xdv \
      --untrusted \
    && rm -rf /tmp/tectonic-warm /tmp/warmup.tex

ENV NODE_ENV=production
ENV COMPILE_TIMEOUT_MS=10000
ENV MAX_QUEUE_DEPTH=64
ENV MAX_CACHE_ENTRIES=128

HEALTHCHECK NONE
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "worker.mjs"]


FROM node:22-bookworm-slim AS worker-graphdrawing

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      dvisvgm \
      fontconfig \
      fonts-noto-cjk \
      texlive-latex-extra \
      texlive-luatex \
      texlive-pictures \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin compiler

WORKDIR /app
COPY --from=service-deps /app/node_modules ./node_modules
COPY --chown=compiler:compiler \
  services/tikz-compiler/worker.mjs \
  services/tikz-compiler/compiler-core.mjs \
  services/tikz-compiler/job-store.mjs \
  services/tikz-compiler/artifact-store.mjs \
  services/tikz-compiler/provenance.mjs \
  lib/tikz/syntax/exact-profile.json \
  lib/tikz/syntax/luatex-graphdrawing-profile.json \
  ./
COPY --chown=compiler:compiler \
  services/tikz-compiler/warmup-graphdrawing.tex \
  /tmp/warmup-graphdrawing.tex

ENV HOME=/home/compiler
ENV TIKZ_COMPILER_PROFILE=tikz-luatex-graphdrawing-v1
USER compiler
RUN node -e "import('./compiler-core.mjs')" \
    && mkdir -p /tmp/luatex-warm \
    && cd /tmp/luatex-warm \
    && lualatex --output-format=dvi --no-shell-escape \
      --halt-on-error --interaction=nonstopmode --file-line-error \
      /tmp/warmup-graphdrawing.tex \
    && dvisvgm --no-fonts --exact --page=1 \
      --output=output.svg warmup-graphdrawing.dvi \
    && rm -rf /tmp/luatex-warm /tmp/warmup-graphdrawing.tex

ENV NODE_ENV=production
ENV COMPILE_TIMEOUT_MS=15000
ENV MAX_QUEUE_DEPTH=32
ENV MAX_CACHE_ENTRIES=128

HEALTHCHECK NONE
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "worker.mjs"]
