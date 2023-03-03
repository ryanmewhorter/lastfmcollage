import fs from "fs";
import { benchmark } from "../Utils.js";
const DEFAULT_EXPIRATION_MS = 2629800000; // 1 month

function load(fileName) {
  if (fs.existsSync(fileName) && fileName.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(fileName));
  } else {
    return {};
  }
}

export default class FileSystemCache {
  /**
   * Create a new CacheService
   * @param {string} fileName
   * @param {object} options
   */
  constructor(fileName, options = {}) {
    this.fileName = fileName;
    this.store = benchmark(`Load file system cache [${fileName}]`, () =>
      load(fileName)
    );
    this.keyTranslate =
      options.keyTranslate != null && typeof options.keyTranslate === "function"
        ? options.keyTranslate
        : (key) => key;
    this.warnCacheMisses = options.warnCacheMisses || false;
    this.expiration = options.expiration || DEFAULT_EXPIRATION_MS;
  }

  save() {
    console.log(`Saving cache [${this.fileName}]...`);
    benchmark(`Save file system cache [${this.fileName}]`, () => {
      this.clean();
      fs.writeFileSync(this.fileName, JSON.stringify(this.store));
    });
  }

  clean() {
    console.log(`Cleaning cache [${this.fileName}]...`);
    let now = Date.now();
    for (let key of Object.keys(this.store)) {
      if (now >= this.store[key].e) {
        console.log(`Key ${key} has expired.`);
        delete this.store[key];
      }
    }
  }

  unset(rawKey) {
    this.set(rawKey, undefined);
  }

  set(rawKey, value, options = {}) {
    this.store[this.keyTranslate(rawKey)] = {
      v: value,
      e: Date.now() + this.expiration,
    };
  }

  get(rawKey, options = { renew: true }) {
    let key = this.keyTranslate(rawKey);
    let storeItem = this.store[key];
    if (storeItem != null) {
      if (options.renew) {
        storeItem.e = Date.now() + this.expiration;
      }
      return storeItem.v;
    } else if (this.warnCacheMisses) {
      console.warn(
        `WARNING: Cache miss for key [${key}] in cache [${this.fileName}]`
      );
    }
    return null;
  }

  destroy() {
    if (fs.existsSync(this.fileName)) {
      fs.unlinkSync(this.fileName);
    }
  }
}
