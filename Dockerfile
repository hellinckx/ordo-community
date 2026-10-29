# Ordo web app (at /app/) for self-hosting – see SELFHOST.md.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY . .
ARG VITE_ORDO_SYNC_URL=""
ARG VITE_ORDO_SYNC_ANON_KEY=""
ARG VITE_ORDO_WEB_URL=""
ENV VITE_ORDO_SYNC_URL=$VITE_ORDO_SYNC_URL \
    VITE_ORDO_SYNC_ANON_KEY=$VITE_ORDO_SYNC_ANON_KEY \
    VITE_ORDO_WEB_URL=$VITE_ORDO_WEB_URL
RUN pnpm install --frozen-lockfile && pnpm build:app

FROM nginx:1.27-alpine
COPY deploy/selfhost/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/packages/app/dist /usr/share/nginx/html
EXPOSE 8080
