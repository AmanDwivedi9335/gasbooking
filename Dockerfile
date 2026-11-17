FROM node:22-bookworm-slim AS deps
WORKDIR /opt/cylinder-ops
COPY package*.json ./
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /opt/cylinder-ops
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /opt/cylinder-ops /opt/cylinder-ops
USER node
EXPOSE 3000
CMD ["npm", "start"]
