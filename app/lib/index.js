const debug = require("debug")("app");

const { hub: hubCloud } = require("./firebase");
const { hub: hubMachine } = require("./machine");

const { logExceptions } = require("./util");

hubMachine.onStateChange(
  logExceptions(async function (eventData) {
    await hubCloud.addEvent(eventData);
  }, debug)
);

hubMachine.onZigbeeEvent(
  logExceptions(async function (eventData) {
    await hubCloud.addZigbeeEvent(eventData);
  }, debug)
);

hubCloud.onSetState;
hubCloud.onSetConfig;
hubCloud.onAddNewDevice;
