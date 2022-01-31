const EventEmitter = require("events");
const bonjour = require("bonjour")();
const debug = require("debug")("app:machine");
const fetch = require("node-fetch");
const fs = require("fs");
const mqtt = require("mqtt");
const util = require("util");
const YAML = require("yaml");

const camelcaseKeys = require("camelcase-keys");
const snakecaseKeys = require("snakecase-keys");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const YAMLStringify = (data) => YAML.stringify(data, { version: "1.1" });

const {
  logExceptions,
  logAndRethrowException,
  logButNotRethrowException,
} = require("./util");

const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_SERVER = process.env.MQTT_SERVER;
const NODE_ENV = process.env.NODE_ENV;

debug("MQTT_USER", MQTT_USER);
debug("MQTT_PASSWORD <secret>");
debug("MQTT_SERVER", MQTT_SERVER);

const fetchSupervisor = async (url, { headers, ...rest } = {}) =>
  await fetch(`http://supervisor/${url}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer: ${process.env.SUPERVISOR_TOKEN}`,
      ...headers,
    },
    ...rest,
  });

const fetchCore = async (url, opts) =>
  await fetchSupervisor(`core/api/${url}`, opts);

/**
 * MQTT
 */
const jsonParse = (payload) =>
  camelcaseKeys(JSON.parse(payload.toString()), {
    deep: true,
  });

/**
 * Zeroconf
 *
 * Android doesn't resolve .local names and its zeroconf (via NSD) is a crap. Therefore, figuring
 * out the LAN IP ourselves and setting it up as zeroconf fqdn name, making it easier for the
 * Android app.
 */
async function setZeroconfName() {
  const res = await fetchSupervisor("network/info");
  if (!res.ok) {
    throw new Error(`Couldn't setup zeroconf: ${await res.text()}`);
  }
  let ip;
  try {
    const { data } = await res.json();
    ip = data.interfaces
      .find((item) => item["interface"] === "eth0")
      .ipv4.address[0].split("/")[0];
    // FIXME, retry in case it's for some reason not ready.
  } catch (error) {
    throw new Error(
      `Couldn't setup zeroconf: ${error.message}\n${error.stack}`
    );
  }

  const noop = () => {};
  const ipUnderscored = ip.replace(/[.]/g, "_");
  // "LarTec Hub API:10_0_0_22"
  bonjour.publish(
    { name: `LarTec Hub API:${ipUnderscored}`, type: "http", port: 4000 },
    noop
  );
  [
    "exit",
    "SIGINT",
    "SIGUSR1",
    "SIGUSR2",
    "uncaughtException",
    "SIGTERM",
  ].forEach((eventType) => {
    process.on(eventType, function () {
      bonjour.unpublishAll();
    });
  });
}

/**
 * Files
 */
// deviceName e.g., "0xb4e3f9fffec64aed"
async function getHADeviceId(deviceName) {
  const rawData = await readFile("/config/.storage/core.device_registry");
  const data = JSON.parse(rawData);
  console.log(data);
  const found = data.data.devices.filter(({ name }) => name === deviceName);
  console.log(found);
  if (found.length !== 1) {
    // FIXME oops
  }
  return found[0].id;
}

function getHAEntityId(deviceName) {
  if (deviceName.indexOf(".") !== -1) {
    return deviceName;
  }
  return `switch.${deviceName}`;
}

const hourMinSecISOFmt = (date) =>
  date
    .toISOString()
    .split("T")[1]
    .split(".")[0]
    .split(":")
    .slice(0, 3)
    .join(":");

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
          if (data.newState === null) {
            debug("ignoring event, because it lacks of newState");
            return;
          }
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

    setZeroconfName().catch(logButNotRethrowException(debug));
  }

  onStateChange(cb) {
    this.ee.on("stateChange", cb);
  }
  onZigbeeEvent(cb) {
    this.ee.on("zigbeeEvent", cb);
  }

  async getStates() {
    return await (await fetchCore("states")).json();
  }

  // deviceId example: 0xb4e3f9fffef96753
  // state example: "on", "off", "toggle"
  async setState({ eventData: { deviceId, state } }) {
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

  async setConfig({ hubProps: { devicesProps = {} } }) {
    const automations = [];
    const groups = {};

    async function addAutomation(
      deviceId,
      trigger,
      triggerSettings = {},
      action
    ) {
      if (trigger === "manual") return;
      if (trigger === "sleep") {
        debug("transforming sleep into schedule");
        trigger === "schedule";
        triggerSettings = {
          entries: [
            {
              time: {
                toDate() {
                  const time = new Date();
                  time.setUTCHours(23);
                  time.setUTCMinutes(0);
                  time.setUTCSeconds(0);
                  debug("toDate", time);
                  return time;
                },
              },
              repetition: "daily",
            },
          ],
        };
        debug(triggerSettings);
      }

      if (trigger === "schedule") {
        for (const eachTriggerSettings of triggerSettings.entries) {
          await addEachAutomation(
            deviceId,
            trigger,
            eachTriggerSettings,
            action
          );
        }
        return;
      }

      await addEachAutomation(deviceId, trigger, triggerSettings, action);
    }

    async function addEachAutomation(
      deviceId,
      trigger,
      triggerSettings = {},
      action
    ) {
      const automation = { mode: "single" };

      if (trigger === "sunrise") {
        automation.trigger = [{ platform: "sun", event: "sunrise" }];
      } else if (trigger === "sunset") {
        automation.trigger = [{ platform: "sun", event: "sunset" }];
      } else if (trigger === "schedule") {
        debug("schedule", triggerSettings);
        const { repetition, repetitionSettings, time } = triggerSettings;
        // Repetition
        if (repetition === "daily") {
          // No condition needed when it's daily.
        } else if (repetition === "theOtherDay") {
          automation.condition = [
            {
              condition: "template",
              value_template: "{{ now().timetuple().tm_yday % 2 == 0 }}",
            },
          ];
        } else if (repetition === "1In3") {
          automation.condition = [
            {
              condition: "template",
              value_template: "{{ now().timetuple().tm_yday % 3 == 0 }}",
            },
          ];
        } else if (repetition === "custom") {
          automation.condition = [
            { condition: "time", weekday: repetitionSettings },
          ];
        } else {
          // FIXME oops
        }

        // Time
        debug("-trigger time", hourMinSecISOFmt(time.toDate()));
        automation.trigger = [
          { platform: "time", at: hourMinSecISOFmt(time.toDate()) },
        ];
      } else if (trigger === "interval") {
        const {
          interval: { hour: hours, min: minutes, sec: seconds },
        } = triggerSettings;
        automation.trigger = [
          {
            platform: "device",
            type: "turned_on",
            device_id: await getHADeviceId(deviceId),
            entity_id: getHAEntityId(deviceId),
            domain: "switch",
            for: {
              hours,
              minutes,
              seconds,
              milliseconds: 0,
            },
          },
        ];
      } else {
        // FIXME oops
      }

      automation.action = [
        {
          service:
            action === "on"
              ? "homeassistant.turn_on"
              : "homeassistant.turn_off",
          entity_id: getHAEntityId(deviceId),
        },
      ];
      automations.push(automation);
    }

    function addGroupMember(group, member) {
      groups[group] = groups[group] || {};
      groups[group].entities = groups[group].entities || new Set();
      // TODO: Make sure member is of the form switch.<>.
      groups[group].entities.add(member);
    }

    await addAutomation("group.night_light", "sunset", {}, "on");
    await addAutomation("group.night_light", "sunrise", {}, "off");
    await addAutomation("group.night_light_while_awake", "sleep", {}, "off");

    for (const [deviceId, { type, automation = {} } = {}] of Object.entries(
      devicesProps
    )) {
      const { turnOn, turnOnSettings, turnOff, turnOffSettings } = automation;

      if (type === "lighting") {
        if (turnOn === "sunset" && turnOff === "sunrise") {
          // All night
          // - Make sure this automation exists.
          addGroupMember("night_light", deviceId);
        } else if (turnOn === "sunset" && turnOff === "sleep") {
          // Night while awake
          // - Make sure this automation exists.
          addGroupMember("night_light", deviceId);
          addGroupMember("night_light_while_awake", deviceId);
        } else if (
          turnOn === "manual" &&
          (turnOff === "sunrise" || turnOff === "sleep")
        ) {
          await addAutomation(deviceId, turnOn, turnOnSettings, "on");
          await addAutomation(deviceId, turnOff, turnOffSettings, "off");
        } else {
          // FIXME: oops
        }
      }

      // type: other (custom)
      if (type === "other") {
        if (!["manual", "sunrise", "sunset", "schedule"].includes(turnOn)) {
          // FIXME: oops
        }
        if (!["sleep", "sunrise", "interval", "schedule"].includes(turnOff)) {
          // FIXME: oops
        }
        await addAutomation(deviceId, turnOn, turnOnSettings, "on");
        await addAutomation(deviceId, turnOff, turnOffSettings, "off");
      }
    }

    // Rewrite config based on props
    if (groups.length) {
      const groupsYaml = YAMLStringify(groups);
      debug("Write groups.yaml\n", groupsYaml);
      if (NODE_ENV === "production") {
        await writeFile("/config/groups.yaml", groupsYaml);
      }
    }

    if (Object.keys(automations).length) {
      const automationsYaml = YAMLStringify(automations);
      debug("Write automations.yaml\n", automationsYaml);
      if (NODE_ENV === "production") {
        await writeFile("/config/automations.yaml", automationsYaml);
      }
    }

    // Reload config:
    let res = await fetchCore("config/core/check_config", { method: "POST" });
    if (!res.ok) {
      throw new Error(`Couldn't reload group: ${await res.text()}`);
    }
    if ((await res.json()).result !== "valid") {
      throw new Error("Config is invalid. Aborting...");
    }

    res = await fetchCore("services/group/reload", { method: "POST" });
    if (!res.ok) {
      throw new Error(`Couldn't reload group: ${await res.text()}`);
    }
    debug("Group config reloaded");

    res = await fetchCore("services/automation/reload", { method: "POST" });
    if (!res.ok) {
      throw new Error(`Couldn't reload automation: ${await res.text()}`);
    }
    debug("Automation config reloaded");
  }

  async addNewDevice() {
    // restart POST supervisor
  }
}

const hub = new Hub();

module.exports = { hub };
