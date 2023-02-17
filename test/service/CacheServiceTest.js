import FileSystemCache from "../../service/CacheService.js";
import fs from "fs";
import { expect } from "chai";

const TEST_FILE_NAME = "test.json";

describe("Cache service", () => {
  let fileSystemCache;

  beforeEach(() => {
    fileSystemCache = new FileSystemCache(TEST_FILE_NAME);
  });

  it("should set key", () => {
    fileSystemCache.set("rawKey", "value");
    expect(fileSystemCache.store["rawKey"])
      .to.have.property("v")
      .that.equals("value");
  });

  it("should save", () => {
    fileSystemCache.save();
    expect(fs.existsSync(TEST_FILE_NAME));
  });

  afterEach(() => {
    fileSystemCache.destroy();
  });
});
