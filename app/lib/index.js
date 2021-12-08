const camelcaseKeys = require("camelcase-keys");
const crypto = require("crypto");
const firebase = require("firebase");
const mqtt = require("mqtt");
require("firebase/auth");
require("firebase/firestore");

const { promisify } = require("util");
const fetch = require("node-fetch");
const fs = require("fs");

const generateKeyPair = promisify(crypto.generateKeyPair);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const rmFile = promisify(fs.rm);
const exists = promisify(fs.exists);

const API_KEY = process.env.API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;
const SENDER_ID = process.env.SENDER_ID;
const APP_ID = process.env.APP_ID;

const KEYS_PATH = process.env.KEYS_PATH;

const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_SERVER = process.env.MQTT_SERVER;

// const FUNCTIONS_URL = "http://localhost:5001/lartec-2d3b9/us-central1";
const FUNCTIONS_URL = "https://us-central1-lartec-2d3b9.cloudfunctions.net";
const PRIV_KEY_FILE = `${KEYS_PATH}/id_rsa`;
const PUB_KEY_FILE = `${KEYS_PATH}/id_rsa`;

firebase.initializeApp({
  apiKey: API_KEY,
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`,
  messagingSenderId: SENDER_ID,
  appId: APP_ID,
});

const db = firebase.firestore();

const log = (...args) => console.log(...args);

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

async function removeCredentials() {
  rmFile(PRIV_KEY_FILE);
  rmFile(PUB_KEY_FILE);
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
    firebase.auth().onAuthStateChanged(async (auth) => {
      if (!auth) {
        this.props = {};
        return;
      }
      log("onAuthStateChanged signIn", auth.uid);
      this.set({ id: auth.uid });
    });
    this.props = {};
    this.events = new HubEvents(this);
  }

  set(props) {
    this.props = { ...this.props, ...props };
  }

  get(prop) {
    return this.props[prop];
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
    try {
      auth = await firebase.auth().signInWithCustomToken(token);
    } catch (error) {
      if (/PEM routines:get_name:no start line/.test(error.message)) {
        await removeCredentials();
        return await this._auth();
      }
      throw error;
    }
    log("AUTH", `successful ${auth.user.uid}`);
    this.set({ id: auth.user.uid });
  }

  async init() {
    await this.auth();
    const hubRef = db.collection("hubs").doc(this.props.id);
    const hubDoc = await hubRef.get();
    if (!hubDoc.exists) {
      // Unexpected.
      throw new Error("Internal error");
    }
    this.set(hubDoc.data());
  }
}

class HubEvents {
  constructor(hub) {
    this.hub = hub;
  }

  async add(props) {
    const { eventType } = props;
    if (eventType === "stateChanged") {
      // If device, set current state to db.
      // const {entityId} = event.data;
      // this.hub.set(devices: {entityId: {state}});
    }
    await this.hub.auth();
    await db.collection("hubsEvents").add({ hubId: this.hub.id, ...props });
  }
}

/**
 * MQTT
 */
const jsonParse = (payload) =>
  camelcaseKeys(JSON.parse(payload.toString()), {
    deep: true,
  });

const client = mqtt.connect(`mqtt://${MQTT_SERVER}`, {
  username: MQTT_USER,
  password: MQTT_PASSWORD,
});

// On disconnection, MQTT will automatically reconnect (attempt on every 1s) and re-subscribe.
client.on("connect", () => {
  log("MQTT", "Connected");
  client.subscribe("lartec/event", (error) => {
    if (error) {
      throw error;
    }
  });
});

client.on("message", async (topic, payload) => {
  if (topic === "lartec/event") {
    const eventData = jsonParse(payload);
    console.log("Received Message:", topic, eventData);
    await hub.events.add(eventData);
  }
});

const hub = new Hub();
