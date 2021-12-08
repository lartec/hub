const firebase = require("firebase");
const crypto = require("crypto");
require("firebase/auth");
require("firebase/firestore");

const { promisify } = require("util");
const fetch = require("node-fetch");
const fs = require("fs");

const generateKeyPair = promisify(crypto.generateKeyPair);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const exists = promisify(fs.exists);

const API_KEY = process.env.API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;
const SENDER_ID = process.env.SENDER_ID;
const APP_ID = process.env.APP_ID;
const KEYS_PATH = process.env.KEYS_PATH;

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
  }

  set(props) {
    this.props = { ...this.props, ...props };
  }

  get(prop) {
    return this.props[prop];
  }

  // Note:
  // firebase.auth().setPersistence("local").signInAnonymously();
  // SignInAnonymously doesn't work on node.js, so implementing our own...
  async auth() {
    if (firebase.auth().currentUser) {
      return;
    }

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

    const auth = await firebase.auth().signInWithCustomToken(token);
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

(async function () {
  const hub = new Hub();
  await hub.auth();
  await hub.init();
  console.log(hub.props);
})().catch((err) => console.error(err));
