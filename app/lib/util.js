const _jsonStringify = require("json-stable-stringify");

function logExceptions(fn, debug) {
  return async function (...args) {
    try {
      await fn(...args);
    } catch (error) {
      debug(error);
      throw error;
    }
  };
}

function logAndRethrowException(debug) {
  return function (error) {
    if (error) {
      debug(error);
      throw error;
    }
  };
}

function logButNotRethrowException(debug) {
  return function (error) {
    if (error) {
      debug(error);
    }
  };
}

const jsonStringify = (object) => _jsonStringify(object);

function objEqual(a, b) {
  return jsonStringify(a) === jsonStringify(b);
}

module.exports = {
  logAndRethrowException,
  logButNotRethrowException,
  logExceptions,
  objEqual,
};
