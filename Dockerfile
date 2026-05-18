# ---- Build / install dependencies ----
# Alpine carries far fewer OS-level CVEs than the Debian-based slim images.
# sharp 0.33 ships prebuilt musl (linuxmusl) binaries that bundle librsvg,
# so SVG rasterization works on Alpine with no extra system packages.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# ---- Runtime image ----
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Drop root: run as the built-in unprivileged "node" user
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public

# The app runs with `node` only — npm is never invoked at runtime.
# Remove the bundled npm CLI (and its vendored deps) to drop its CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /app/output && chown node:node /app/output

USER node

EXPOSE 3000

CMD ["node", "server.js"]
