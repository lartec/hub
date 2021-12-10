const firebase = require("firebase");
require("firebase/auth");
require("firebase/firestore");

const EventEmitter = require("events");
const crypto = require("crypto");
const debug = require("debug")("app:firebase");
const fetch = require("node-fetch");
const fs = require("fs");
const { promisify } = require("util");

const { logAndRethrowException } = require("./util");

const generateKeyPair = promisify(crypto.generateKeyPair);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const rmFile = promisify(fs.unlink);
const exists = promisify(fs.exists);

const API_KEY = process.env.API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;
const SENDER_ID = process.env.SENDER_ID;
const APP_ID = process.env.APP_ID;

const KEYS_PATH = process.env.KEYS_PATH;

debug("API_KEY <secret>");
debug("PROJECT_ID", PROJECT_ID);
debug("SENDER_ID", SENDER_ID);
debug("APP_ID", APP_ID);
debug("KEYS_PATH", KEYS_PATH);

// const FUNCTIONS_URL = "http://localhost:5001/lartec-2d3b9/us-central1";
const FUNCTIONS_URL = "https://us-central1-lartec-2d3b9.cloudfunctions.net";
const PRIV_KEY_FILE = `${KEYS_PATH}/id_rsa`;
const PUB_KEY_FILE = `${KEYS_PATH}/id_rsa.pub`;

firebase.initializeApp({
  apiKey: API_KEY,
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`,
  messagingSenderId: SENDER_ID,
  appId: APP_ID,
});

const db = firebase.firestore();

async function getCredentials() {
  let publicKey, privateKey;
  let publicKeyText, privateKeyText;
  if (await exists(PRIV_KEY_FILE)) {
    privateKeyText = (await readFile(PRIV_KEY_FILE)).toString();
    privateKey = crypto.createPrivateKey({
      key: privateKeyText,
      passphrase: "",
    });
  }
  if (await exists(PUB_KEY_FILE)) {
    publicKeyText = (await readFile(PUB_KEY_FILE)).toString().trim();
    publicKey = crypto.createPublicKey(publicKeyText);
  }
  if (!privateKey || !publicKey) {
    ({ publicKey, privateKey } = await generateKeyPair("rsa", {
      modulusLength: 4096,
    }));
    privateKeyText = privateKey.export({
      format: "pem",
      type: "pkcs8",
      cipher: "aes-256-cbc",
      passphrase: "",
    });
    publicKeyText = publicKey.export({ format: "pem", type: "spki" }).trim();
    await writeFile(PRIV_KEY_FILE, privateKeyText);
    await writeFile(PUB_KEY_FILE, publicKeyText);
  }

  return { privateKey, privateKeyText, publicKey, publicKeyText };
}

// eslint-disable-next-line no-unused-vars
async function removeCredentials() {
  await rmFile(PRIV_KEY_FILE);
  await rmFile(PUB_KEY_FILE);
}

async function ResponseError(res) {
  if (!res.json) {
    return new Error(res);
  }
  return new Error(await res.json());
}

/**
 * HUB
 */
class Hub {
  constructor() {
    this.props = {};
    this.ee = new EventEmitter();

    firebase.auth().onAuthStateChanged(async (auth) => {
      if (!auth) {
        this.props = {};
        if (this.realtimeUnsubscribe1) {
          this.realtimeUnsubscribe1();
        }
        if (this.realtimeUnsubscribe2) {
          this.realtimeUnsubscribe2();
        }
        return;
      }
      debug("onAuthStateChanged signIn", auth.uid);
      this.set({ id: auth.uid });
    });
  }

  onSetState(cb) {
    this.ee.on("onSetState", cb);
  }

  onSetConfig(cb) {
    this.ee.on("onSetConfig", cb);
  }

  onAddNewDevice(cb) {
    this.ee.on("onAddNewDevice", cb);
  }

  actionsQueue() {
    db.collection("hubsActionsQueue").where("hubId", "==", this.props.id);
    return db
      .collection("hubsActionsQueue")
      .where("hubId", "==", this.props.id);
  }

  docRef() {
    return db.collection("hubs").doc(this.props.id);
  }

  set(props) {
    this.props = { ...this.props, ...props };
  }

  async auth() {
    // If hub is already authenticated, immediately returns.
    if (firebase.auth().currentUser) {
      return;
    }

    // Otherwise, sign in (multiple calls always return the same signIn Promise)
    if (this.signingIn) {
      return this.signingIn;
    }
    this.signingIn = this._auth();
    await this.signingIn;
    delete this.signingIn;
  }

  // Note:
  // firebase.auth().setPersistence("local").signInAnonymously();
  // SignInAnonymously doesn't work on node.js, so implementing our own...
  async _auth() {
    const { privateKey, publicKeyText } = await getCredentials();

    let res;
    res = await fetch(`${FUNCTIONS_URL}/authInitiate`, {
      method: "PUT",
      body: JSON.stringify({ publicKey: publicKeyText }),
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw await ResponseError(res);
    }
    const { sample } = await res.json();
    debug({ sample });
    const signature = crypto
      .sign("sha512", Buffer.from(sample), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      })
      .toString("base64");

    res = await fetch(`${FUNCTIONS_URL}/auth`, {
      method: "PUT",
      body: JSON.stringify({ publicKey: publicKeyText, signature }),
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(JSON.stringify(await res.json()));
    }
    const { token } = await res.json();

    let auth;
    auth = await firebase.auth().signInWithCustomToken(token);
    debug(`AUTH successful ${auth.user.uid}`);
    this.set({ id: auth.user.uid });

    // Listen to realtime udpates
    this.realtimeUnsubscribe1 = this.docRef().onSnapshot((doc) => {
      this.set(doc.data());
    });
    this.realtimeUnsubscribe2 = this.actionsQueue().onSnapshot(
      (querySnapshot) => {
        querySnapshot.forEach((doc) => this._emitTakeAction(doc));
      }
    );
  }

  _emitTakeAction(doc) {
    const id = doc.id;
    const { action, ...rest } = doc.data();
    const event = {
      addNewDevice: "onAddNewDevice",
      setConfig: "onSetConfig",
      setState: "onSetState",
    }[action];
    if (!event) {
      throw new Error("Missing action listener");
    }
    const isListened = this.ee.emit(event, rest);
    debug(`emit ${event} ${rest}`);
    if (isListened) {
      db.collection("hubsActionsQueue")
        .doc(id)
        .delete()
        .catch(logAndRethrowException);
    }
  }

  async init() {
    await this.auth();
    const hubDoc = await this.docRef().get();
    if (!hubDoc.exists) {
      // Unexpected.
      throw new Error("Internal error");
    }
    const data = hubDoc.data();
    debug("init", data);
    this.set(data);

    // Process pending actions
    (await this.actionsQueue().get()).forEach((doc) =>
      this._emitTakeAction(doc)
    );
  }

  async addEvent(eventProps) {
    await this.auth();
    const { logLevel } = this.props;
    const { eventType, data } = eventProps;
    const { entityId } = data.newState;

    const addHubsEvents = async () => {
      debug(`Add ${entityId} ${eventType} into hubsEvents`);
      await db
        .collection("hubsEvents")
        .add({ hubId: this.props.id, ...eventProps });
    };

    // Add event in hubsEvents
    if (logLevel === "debug") {
      // On debug mode, add all of them.
      await addHubsEvents();
    } else {
      // On normal mode, add the switch ones.
      if (eventType === "state_changed" && entityId.startsWith("switch.")) {
        await addHubsEvents();
      }
    }

    // Update hub according to event
    // TODO: Batch state changes from multiple devices to save on write requests
    if (eventType === "state_changed" && entityId.startsWith("switch.")) {
      const deviceId = entityId.split(".")[1];

      const {
        context, // eslint-disable-line no-unused-vars
        entityId: _, // eslint-disable-line no-unused-vars
        attributes: {
          friendlyName, // eslint-disable-line no-unused-vars
          ...attributes
        },
        ...rest
      } = data.newState;
      await this.docRef().set(
        {
          devices: {
            [deviceId]: {
              attributes,
              ...rest,
            },
          },
        },
        { merge: true }
      );
    }
  }

  async addZigbeeEvent({ topic, data }) {
    const { logLevel } = this.props;

    const addHubsZigbeeEvents = async () => {
      debug(`Add ${topic} ${data} into hubsZigbeeEvents`);
      await this.auth();
      await db
        .collection("hubsZigbeeEvents")
        .add({ hubId: this.props.id, topic, data });
    };

    // Add event in hubsZigbeeEvents
    if (logLevel === "debug") {
      // On debug mode, add all of them.
      await addHubsZigbeeEvents();
    } else {
      // On normal mode, add none.
    }
  }
}

const hub = new Hub();
hub.init().catch(logAndRethrowException(debug));

module.exports = { hub, db };
