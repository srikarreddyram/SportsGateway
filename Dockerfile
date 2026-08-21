# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# The API contract the gateway serves at /docs and /openapi.json — read from disk at
# startup (src/routes/docs.js), not bundled into a JS module, so it has to ship too.
COPY openapi.yaml ./

# Run unprivileged; the node image already ships a `node` user.
USER node

EXPOSE 3000

# In-process, not "does the container exist": a hung event loop still has a living
# process. Written for the gateway command (port 3000) — docker-compose.yml's own
# healthcheck: blocks override this per-service, which is what makes the worker
# service correctly check its port 3100 instead despite sharing this image. A bare
# `docker run` of the worker command, with no compose file to supply that override,
# would incorrectly report unhealthy against this probe; compose is the supported path.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The gateway and the analytics worker share this image and differ only by command,
# so both processes always run identical code.
CMD ["node", "src/index.js"]
