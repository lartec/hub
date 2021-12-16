ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8
ENV NODE_ENV="production"
ARG BUILD_VERSION

RUN apk add --no-cache jq yq nodejs npm

COPY rootfs /
COPY app /app
COPY envs/prod /app/.env

EXPOSE 4000
