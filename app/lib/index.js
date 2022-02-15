const debug = require("debug")("app");
const express = require("express");

const { hub: hubCloud } = require("./firebase");
const { hub: hubMachine } = require("./machine");
const { logExceptions } = require("./util");

const port = process.env.PORT || 4000;

/**
 * Listen to machine and cloud events
 */
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
  logExceptions(async function (data) {
    await hubMachine.setState(data);
  }, debug)
);

hubCloud.onPropsChange(
  logExceptions(async function (...args) {
    await hubMachine.setHubProps(...args);
  }, debug)
);

hubCloud.onAddNewDevice(logExceptions(async function () {}, debug));

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ data: "Go to https://lar.tec.br" });
});

/**
 * Listen to http server events
 */
// GET /manifest
app.get("/manifest", (req, res) => {
  res.json({ hubId: hubCloud.props.id });
});

// PUT /users/{userId}
app.put("/users/:userId", async (req, res, next) => {
  const { userId } = req.params;
  if (!userId) {
    return next(new Error("Missing required userId param"));
  }
  try {
    await hubCloud.addUser(userId);
  } catch (error) {
    return next(error);
  }
  res.json({ data: "ok" });
});

// PUT /devices/{deviceId}
app.put("/devices/:deviceId", async (req, res, next) => {
  const { deviceId } = req.params;
  const { state } = req.body || {};
  if (!deviceId) {
    return next(new Error("Missing required deviceId param"));
  }
  if (!state) {
    return next(new Error("Missing required body.state param"));
  }
  try {
    await hubMachine.setState({ deviceId, state });
  } catch (error) {
    return next(error);
  }
  res.json({ data: "ok" });
});

// Error handler
app.use(function (error, req, res, next) {
  try {
    const { message, status = 500 } = error;
    const url = req.originalUrl || req.url;
    res.status(status).json({ error: error.message });
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
