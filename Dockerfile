# Build context: the install folder containing metrc-manager-3000-platform/ and metrc-manager-3000-client/
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
ENV COREPACK_HOME=/usr/local/share/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && chmod -R a+rX /usr/local/share/corepack

FROM base AS client
WORKDIR /src/metrc-manager-3000-client
COPY metrc-manager-3000-client/package.json metrc-manager-3000-client/package-lock.json ./
# --ignore-scripts: the client's `prepare` build needs src/, copied next
RUN npm ci --ignore-scripts
COPY metrc-manager-3000-client/ ./
RUN npm run build

FROM base AS build
WORKDIR /src/metrc-manager-3000-platform
COPY --from=client /src/metrc-manager-3000-client /src/metrc-manager-3000-client
COPY metrc-manager-3000-platform/package.json metrc-manager-3000-platform/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY metrc-manager-3000-platform/ ./
ARG NEXT_PUBLIC_BRAND_NAME="METRC Manager 3000"
ARG NEXT_PUBLIC_BRAND_LOGO_URL=/brand/logo.svg
ENV NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME NEXT_PUBLIC_BRAND_LOGO_URL=$NEXT_PUBLIC_BRAND_LOGO_URL
# Build-time stubs; real values are injected at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build NEXTAUTH_SECRET=build-only NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec prisma generate && pnpm exec next build

FROM base AS runtime
ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH
RUN arch="${TARGETARCH:-amd64}" \
 && case "$arch" in \
      amd64) sha1=71b0d58cc53f6bd72cf2f293e09e294b79c666d8 ;; \
      arm64) sha1=e0f0c06ebc5627e43b25475711e694450489ab00 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${arch}" \
 && echo "${sha1}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN useradd -r -u 1001 app
COPY --chown=app:app --from=client /src/metrc-manager-3000-client /metrc-manager-3000-client
WORKDIR /app
COPY --chown=app:app --from=build /src/metrc-manager-3000-platform /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s CMD curl -fsS http://localhost:${PORT:-3000}/api/health || exit 1
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["web"]
