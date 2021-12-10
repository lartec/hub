const EventEmitter = require("events");
const mqtt = require("mqtt");
const debug = require("debug")("app:machine");

const camelcaseKeys = require("camelcase-keys");
const snakecaseKeys = require("snakecase-keys");

const {
  logExceptions,
  logAndRethrowException,
  logButNotRethrowException,
} = require("./util");

const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_SERVER = process.env.MQTT_SERVER;

debug("MQTT_USER", MQTT_USER);
debug("MQTT_PASSWORD <secret>");
debug("MQTT_SERVER", MQTT_SERVER);

/**
 * MQTT
 */
const jsonParse = (payload) =>
  camelcaseKeys(JSON.parse(payload.toString()), {
    deep: true,
  });

class Hub {
  constructor() {
    this.ee = new EventEmitter();

    const mqttDebug = debug.extend("mqtt");
    const classDebug = debug.extend("hub");

    const client = mqtt.connect(MQTT_SERVER, {
      username: MQTT_USER,
      password: MQTT_PASSWORD,
    });
    this.client = client;

    // On disconnection, MQTT will automatically reconnect (attempt on every 1s) and re-subscribe.
    client.on(
      "connect",
      logExceptions(() => {
        mqttDebug("connected");
        client.subscribe(
          ["lartec/event", "zigbee2mqtt/#"],
          logAndRethrowException(debug)
        );
      }, debug)
    );

    client.on(
      "message",
      logExceptions((topic, payload) => {
        mqttDebug(`received ${topic} message`, payload.toString());
        if (topic === "lartec/event") {
          const data = jsonParse(payload);
          classDebug("emit onStateChange event", topic, data);
          this.ee.emit("stateChange", data);
          return;
        }
        if (topic.startsWith("zigbee2mqtt")) {
          let data;
          try {
            data = jsonParse(payload);
          } catch (error) {
            if (/SyntaxError.*JSON/.test(error)) {
              data = payload.toString();
            } else {
              throw error;
            }
          }
          classDebug("emit zigbeeEvent event", topic, data);
          this.ee.emit("zigbeeEvent", { topic, data });
          return;
        }
        mqttDebug("received other message:", topic, payload.toString());
      }, debug)
    );

    client.on("error", logButNotRethrowException(debug));
  }

  onStateChange(cb) {
    this.ee.on("stateChange", cb);
  }
  onZigbeeEvent(cb) {
    this.ee.on("zigbeeEvent", cb);
  }

  // deviceId example: 0xb4e3f9fffef96753
  // state example: "on", "off", "toggle"
  async setState({ deviceId, state }) {
    const entityId = `switch.${deviceId}`;
    const service = {
      on: "turn_on",
      off: "turn_off",
      toggle: "toggle",
    }[state];
    this.client.publish(
      "lartec/setState",
      JSON.stringify(snakecaseKeys({ entityId, service }, { deep: true }))
    );
  }

  async setConfig() {
    // Group reload:
    // call_service:
    //     "domain": "group",
    //     "service": "reload",
    //     "service_data": {}
    // },
    //
    // Automation reload
    //     "domain": "automation",
    //     "service": "reload",
    //     "service_data": {}
    //
    // POST http://supervisor/core/api/...
    // -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" -H "Content-Type: application/json"
    // POST /api/services/group/reload
    // POST /api/services/automation/reload
  }

  async addNewDevice() {
    // restart POST supervisor
  }
}

const hub = new Hub();

module.exports = { hub };
