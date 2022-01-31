#!/usr/bin/with-contenv bashio

# Code borrowed from:
# https://github.com/zigbee2mqtt/hassio-zigbee2mqtt/blob/master/common/rootfs/etc/cont-init.d/zigbee2mqtt.sh

MQTT_SERVER=$(bashio::config 'mqtt.server')
MQTT_USER=$(bashio::config 'mqtt.user')
MQTT_PASSWORD=$(bashio::config 'mqtt.password')

if ! bashio::services.available "mqtt" && ! bashio::config.exists 'mqtt.server'; then
    bashio::exit.nok "No internal MQTT service found and no MQTT server defined. Please install Mosquitto broker or specify your own."
else
    bashio::log.info "MQTT available, fetching server details..."
    if ! bashio::config.exists 'mqtt.server'; then
        MQTT_PREFIX="mqtt://"
        if [ $(bashio::services mqtt "ssl") = true ]; then
            MQTT_PREFIX="mqtts://"
        fi
        MQTT_SERVER="$MQTT_PREFIX$(bashio::services mqtt "host"):$(bashio::services mqtt "port")"
        bashio::log.info "- MQTT_SERVER='$MQTT_SERVER'"
    fi
    if ! bashio::config.exists 'mqtt.user'; then
        MQTT_USER=$(bashio::services mqtt "username")
        MQTT_PASSWORD=$(bashio::services mqtt "password")
        bashio::log.info "- MQTT_USER='$MQTT_USER'"
        bashio::log.info "- MQTT_PASSWORD='<secret>'"
    fi
fi

# CONFIG_PATH=/data/options.json
bashio::log.info "Adjusting LarTec Hub yaml config with add-on quirks..."
# echo "{}" \
#     | MQTT_USER="$MQTT_USER" jq '.mqtt.user=env.MQTT_USER' \
#     | MQTT_PASSWORD="$MQTT_PASSWORD" jq '.mqtt.password=env.MQTT_PASSWORD' \
#     | MQTT_SERVER="$MQTT_SERVER" jq '.mqtt.server=env.MQTT_SERVER' \
#     > /data/configuration.json
echo 'export MQTT_USER="'$MQTT_USER'"' > /data/envs
echo 'export MQTT_PASSWORD="'$MQTT_PASSWORD'"' >> /data/envs
echo 'export MQTT_SERVER="'$MQTT_SERVER'"' >> /data/envs

# LarTec custom_component
mkdir -p /config/custom_components/lartec
cp -a /custom_components/lartec/* /config/custom_components/lartec/
yq e '.lartec=true' -i /config/configuration.yaml
