const debug = require("debug")("app");
const express = require("express");

const { hub: hubCloud } = require("./firebase");
const { hub: hubMachine } = require("./machine");
const { logExceptions } = require("./util");

const port = process.env.PORT || 4000;

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

const app = express();

app.get("/", (req, res) => {
  res.json({ data: "Go to https://lar.tec.br" });
});

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
