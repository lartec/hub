ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8
ARG BUILD_VERSION

RUN apk add --no-cache jq nodejs npm

COPY rootfs /
COPY custom_components /config/custom_components
