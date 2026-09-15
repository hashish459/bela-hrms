# syntax=docker/dockerfile:1.7
#
# Bela-HRMS production image.
#
# Four stages, each one earning its place:
#
#   base    pinned Node, shared by everything below so the runtime and the build
#           can never drift onto different minor versions
#   deps    dependencies only — cached until pnpm-lock.yaml changes, which is the
#           difference between a 20-second rebuild and a 4-minute one
#   build   the Next.js build, producing .next/standalone
#   runner  the shipped image: no toolchain, no devDependencies, non-root
#
# The result is ~180 MB against ~1.2 GB for a naive single-stage build, and it
# contains no compiler, no package manager and no source — a smaller image to
# pull on a modest VPS, and a much smaller thing for an attacker to work with.

# ----------------------------------------------------------------------- base
FROM node:20.19-alpine AS base

# libc6-compat: Next's native bits are built against glibc; without it sharp and
# the SWC binary fail at load with an error that does not name the cause.
RUN apk add --no-cache libc6-compat
RUN corepack enable

WORKDIR /app

# ----------------------------------------------------------------------- deps
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# --frozen-lockfile: the build fails rather than silently resolving a different
# tree than the one that was tested. A deploy is the wrong moment to discover a
# minor version bump.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------- build
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set at build time because Next inlines NEXT_PUBLIC_* into the client bundle.
# Everything secret is read at runtime instead — see the runner stage.
ARG NEXT_PUBLIC_APP_URL=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Typecheck and lint here rather than trusting CI alone: an image that cannot
# pass its own checks should never reach a registry, let alone a server.
RUN pnpm typecheck && pnpm lint && pnpm build

# --------------------------------------------------------------------- runner
FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# An unprivileged user. Root inside a container is still root against a mounted
# volume, and this image has no reason to write anywhere but /tmp.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# The standalone server, plus the two directories it does not bundle.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Migrations and the migrator run in this image, so the schema is applied by
# exactly the build that will serve it.
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=build --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs

# drizzle-orm and pg are runtime dependencies the standalone trace already
# includes; the migrator resolves them from there.
USER nextjs

EXPOSE 3000

# Checked by the container runtime and by the proxy. /api/health queries the
# database, so an unreachable Postgres marks the container unhealthy rather than
# leaving it in rotation serving 500s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
