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

hubCloud.onSetState(
  logExceptions(async function (props) {
    await hubMachine.setState(props);
  }, debug)
);

hubCloud.onSetConfig(logExceptions(async function () {}, debug));

hubCloud.onAddNewDevice(logExceptions(async function () {}, debug));
