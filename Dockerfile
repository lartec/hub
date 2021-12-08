ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8
ARG BUILD_VERSION

RUN apk add --no-cache jq nodejs npm

COPY rootfs /
COPY app /app
COPY envs/prod /app/.env

# COPY custom_components/lartec /config/custom_components/lartec
