#!/usr/bin/with-contenv bashio

# Code borrowed from:
# https://github.com/zigbee2mqtt/hassio-zigbee2mqtt/blob/master/common/rootfs/etc/cont-init.d/zigbee2mqtt.sh

DATA_PATH=$(bashio::config 'data_path')
MQTT_SERVER=$(bashio::config 'mqtt.server')
MQTT_USER=$(bashio::config 'mqtt.user')
MQTT_PASSWORD=$(bashio::config 'mqtt.password')

if ! bashio::services.available "mqtt" && ! bashio::config.exists 'mqtt.server'; then
    bashio::exit.nok "No internal MQTT service found and no MQTT server defined. Please install Mosquitto broker or specify your own."
else
    bashio::log.info "MQTT available, fetching server detail ..."
    if ! bashio::config.exists 'mqtt.server'; then
        bashio::log.info "MQTT server settings not configured, trying to auto-discovering ..."
        MQTT_PREFIX="mqtt://"
        if [ $(bashio::services mqtt "ssl") = true ]; then
            MQTT_PREFIX="mqtts://"
        fi
        MQTT_SERVER="$MQTT_PREFIX$(bashio::services mqtt "host"):$(bashio::services mqtt "port")"
        bashio::log.info "Configuring '$MQTT_SERVER' mqtt server"
    fi
    if ! bashio::config.exists 'mqtt.user'; then
        bashio::log.info "MQTT credentials not configured, trying to auto-discovering ..."
        MQTT_USER=$(bashio::services mqtt "username")
        MQTT_PASSWORD=$(bashio::services mqtt "password")
        bashio::log.info "Configuring'$MQTT_USER' mqtt user"
    fi
fi

bashio::log.debug "Checking if $DATA_PATH exists"
if ! bashio::fs.directory_exists "$DATA_PATH"; then
    bashio::log.warning "Data path $DATA_PATH not found"
    mkdir -p "$DATA_PATH" || bashio::exit.nok "Could not create $DATA_PATH"
    bashio::log.debug "Created $DATA_PATH"
else
    bashio::log.debug "Check if yaml config file exists"
    if bashio::fs.file_exists "$DATA_PATH/configuration.yaml"; then
        bashio::log.info "Previous config file found, checking backup"
        if ! bashio::fs.file_exists "$DATA_PATH/configuration.yaml.bk"; then
            bashio::log.info "Creating backup config in '$DATA_PATH/.configuration.yaml.bk'"
            cp $DATA_PATH/configuration.yaml $DATA_PATH/.configuration.yaml.bk
        else
            bashio::log.info "Backup already exists, skipping"
        fi
    else
        bashio::log.warning "No configuration found yet to backup"
    fi
fi

# CONFIG_PATH=/data/options.json
bashio::log.info "Adjusting LarTec Hub yaml config with add-on quirks..."
# cat "$CONFIG_PATH" \
echo "" \
    | MQTT_USER="$MQTT_USER"  jq '.mqtt.user=env.MQTT_USER' \
    | MQTT_PASSWORD="$MQTT_PASSWORD" jq '.mqtt.password=env.MQTT_PASSWORD' \
    | MQTT_SERVER="$MQTT_SERVER" jq '.mqtt.server=env.MQTT_SERVER' \
    > $DATA_PATH/configuration.yaml

# LarTec custom_component
bashio::log.info "Copying LarTec custom_component..."
