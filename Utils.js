import moment from "moment";

export function isBlank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function isNotBlank(value) {
  return !isBlank(value);
}

export function requireNotBlank(name, value) {
  if (isBlank(value)) {
    throw new Error(`Variable [${name}] cannot be blank.`);
  }
}

export function randomString(length = 16) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function secondsToTime(s) {
  return millisecondsToTime(s * 1000);
}

export function millisecondsToTime(ms) {
  return moment.utc(ms).format("HH:mm:ss");
}

/**
 *
 * @param {string} text
 * @param {number} maxLength
 * @param {string} trimmedIndicator
 */
export function trimText(text, maxLength, trimmedIndicator = "...") {
  if (text.length > maxLength) {
    return (
      text.substring(0, maxLength - trimmedIndicator.length) + trimmedIndicator
    );
  }
  return text;
}

export function benchmark(taskName, fn) {
  let start = Date.now();
  logTaskStart(taskName, start);
  let result = fn();
  logTaskComplete(taskName, start);
  return result;
}

/**
 *
 * @param {string} taskName
 * @param {Promise} promise
 * @returns {Promise}
 */
export function benchmarkPromise(taskName, promise) {
  let start = Date.now();
  logTaskStart(taskName, start);
  return promise.then((result) => {
    logTaskComplete(taskName, start);
    return result;
  });
}

function logTaskStart(taskName, start) {
  console.log(`Task [${taskName}] started at [${moment.utc(start).format()}].`);
}

function logTaskComplete(taskName, start) {
  let end = Date.now();
  let elapsedTime = moment.duration(end - start, "ms");
  console.log(
    `Task [${taskName}] completed at [${moment
      .utc(end)
      .format()}] and took ${elapsedTime.minutes()}m ${elapsedTime.seconds()}s.`
  );
}
