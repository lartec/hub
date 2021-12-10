const debug = require("debug")("app");
const express = require("express");

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

const port = process.env.PORT || 4000;
const app = express();

app.get("/", (req, res) => {
  res.json({ foo: "bar" });
});

// Error handler
app.use(function (error, req, res, next) {
  try {
    const { message, status = 500 } = error;
    const url = req.originalUrl || req.url;
    res.status(status).json({ message });
    console.error(
      `HTTP ERROR ${req.method} ${url}`,
      JSON.stringify(
        {
          status,
          message,
          useragent: req.headers["user-agent"],
          ...req.infoProps,
        },
        null,
        2
      )
    );
  } catch (error) {
    next(error);
  }
});

app.listen(port);
debug(`Server listening on port ${port}`);
