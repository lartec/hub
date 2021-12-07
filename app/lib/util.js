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

module.exports = {
  logExceptions,
  logAndRethrowException,
  logButNotRethrowException,
};
