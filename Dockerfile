# One image for the web app, the MCP server and the database setup job (README, "Local Kubernetes").
#   node apps/web/build                    the web app on $PORT (3000)
#   node packages/mcp/dist/cli/serve.js    the MCP server on $CASEBOOK_MCP_PORT (5190)
#   node packages/store/dist/cli/seed.js   migrate the database, then load the demo data once

ARG NODE_VERSION=22.22.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# Install every dependency from the lockfile, then build the packages in dependency order.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/model/package.json packages/model/
COPY packages/sheet-import/package.json packages/sheet-import/
COPY packages/store/package.json packages/store/
COPY packages/wizard-agent/package.json packages/wizard-agent/
COPY packages/mcp/package.json packages/mcp/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web apps/web
COPY packages packages
RUN for p in model sheet-import store wizard-agent mcp; do \
		pnpm --filter "@casebook/$p" exec tsc -p tsconfig.build.json || exit 1; \
	done \
	&& pnpm --filter @casebook/web exec svelte-kit sync \
	&& pnpm --filter @casebook/web exec vite build

# The MCP server and the setup job run from the packages' output, so they need the production
# dependencies of mcp, store and model; the web build bundles everything it uses.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/model/package.json packages/model/
COPY packages/store/package.json packages/store/
COPY packages/mcp/package.json packages/mcp/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
	pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@casebook/mcp..."

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 CASEBOOK_FILES_DIR=/data/files
COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=prod-deps --chown=node:node /app/packages/model/node_modules packages/model/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/store/node_modules packages/store/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/mcp/node_modules packages/mcp/node_modules
COPY --from=build --chown=node:node /app/packages/model/package.json packages/model/
COPY --from=build --chown=node:node /app/packages/model/dist packages/model/dist
COPY --from=build --chown=node:node /app/packages/model/schema packages/model/schema
COPY --from=build --chown=node:node /app/packages/store/package.json packages/store/
COPY --from=build --chown=node:node /app/packages/store/dist packages/store/dist
COPY --from=build --chown=node:node /app/packages/store/drizzle packages/store/drizzle
COPY --from=build --chown=node:node /app/packages/mcp/package.json packages/mcp/
COPY --from=build --chown=node:node /app/packages/mcp/dist packages/mcp/dist
COPY --from=build --chown=node:node /app/apps/web/package.json apps/web/
COPY --from=build --chown=node:node /app/apps/web/build apps/web/build
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 3000 5190
CMD ["node", "apps/web/build"]
