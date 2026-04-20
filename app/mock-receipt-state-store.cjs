const fs = require("fs");
const path = require("path");

const JSON_STATE_STORE_ENVELOPE_VERSION = 1;

function cloneJsonValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeRevision(revision) {
  return Math.max(0, Number(revision || 0));
}

function createJsonStateStoreEntry(value = null, revision = 0) {
  return {
    value: cloneJsonValue(value),
    revision: normalizeRevision(revision),
  };
}

function isJsonStateStore(store) {
  return (
    store &&
    typeof store === "object" &&
    ((typeof store.readEntry === "function" &&
      typeof store.writeEntry === "function" &&
      typeof store.clearEntry === "function") ||
      (typeof store.read === "function" &&
        typeof store.write === "function" &&
        typeof store.clear === "function"))
  );
}

class MemoryJsonStateStore {
  constructor({ value = null, label = "memory", revision = 0 } = {}) {
    this.value = cloneJsonValue(value);
    this.label = String(label || "memory");
    this.revision = normalizeRevision(revision);
  }

  describe() {
    return {
      kind: "memory",
      label: this.label,
      revision: this.revision,
    };
  }

  readEntry() {
    return createJsonStateStoreEntry(this.value, this.revision);
  }

  read() {
    return this.readEntry().value;
  }

  writeEntry(value, { expectedRevision } = {}) {
    const normalizedExpectedRevision =
      expectedRevision === undefined || expectedRevision === null
        ? null
        : normalizeRevision(expectedRevision);

    if (
      normalizedExpectedRevision !== null &&
      normalizedExpectedRevision !== this.revision
    ) {
      return {
        ok: false,
        conflict: true,
        ...this.readEntry(),
      };
    }

    this.value = cloneJsonValue(value);
    this.revision += 1;

    return {
      ok: true,
      conflict: false,
      ...this.readEntry(),
    };
  }

  write(value, options = {}) {
    return this.writeEntry(value, options).value;
  }

  clearEntry({ expectedRevision } = {}) {
    const normalizedExpectedRevision =
      expectedRevision === undefined || expectedRevision === null
        ? null
        : normalizeRevision(expectedRevision);

    if (
      normalizedExpectedRevision !== null &&
      normalizedExpectedRevision !== this.revision
    ) {
      return {
        ok: false,
        conflict: true,
        ...this.readEntry(),
      };
    }

    this.value = null;
    this.revision += 1;

    return {
      ok: true,
      conflict: false,
      ...this.readEntry(),
    };
  }

  clear(options = {}) {
    return this.clearEntry(options);
  }
}

function createEnvelope(value = null, revision = 0) {
  return {
    __jsonStateStoreEnvelope: true,
    version: JSON_STATE_STORE_ENVELOPE_VERSION,
    revision: normalizeRevision(revision),
    value: cloneJsonValue(value),
  };
}

function parseEnvelope(value) {
  if (
    value &&
    typeof value === "object" &&
    value.__jsonStateStoreEnvelope === true
  ) {
    return createJsonStateStoreEntry(value.value, value.revision);
  }

  return createJsonStateStoreEntry(value, 0);
}

class FileJsonStateStore {
  constructor({ filePath } = {}) {
    this.filePath = path.resolve(String(filePath || ""));
  }

  describe() {
    const entry = this.readEntry();

    return {
      kind: "file",
      path: this.filePath,
      revision: entry.revision,
    };
  }

  readEntry() {
    try {
      if (!this.filePath || !fs.existsSync(this.filePath)) {
        return createJsonStateStoreEntry(null, 0);
      }

      return parseEnvelope(JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch (error) {
      return createJsonStateStoreEntry(null, 0);
    }
  }

  read() {
    return this.readEntry().value;
  }

  writeEntry(value, { expectedRevision } = {}) {
    const currentEntry = this.readEntry();
    const normalizedExpectedRevision =
      expectedRevision === undefined || expectedRevision === null
        ? null
        : normalizeRevision(expectedRevision);

    if (
      normalizedExpectedRevision !== null &&
      normalizedExpectedRevision !== currentEntry.revision
    ) {
      return {
        ok: false,
        conflict: true,
        ...currentEntry,
      };
    }

    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempFilePath = `${this.filePath}.tmp`;
    const nextEntry = createEnvelope(value, currentEntry.revision + 1);
    const payload = JSON.stringify(nextEntry, null, 2);
    fs.writeFileSync(tempFilePath, payload, "utf8");
    fs.renameSync(tempFilePath, this.filePath);

    return {
      ok: true,
      conflict: false,
      ...createJsonStateStoreEntry(nextEntry.value, nextEntry.revision),
    };
  }

  write(value, options = {}) {
    return this.writeEntry(value, options).value;
  }

  clearEntry({ expectedRevision } = {}) {
    const currentEntry = this.readEntry();
    const normalizedExpectedRevision =
      expectedRevision === undefined || expectedRevision === null
        ? null
        : normalizeRevision(expectedRevision);

    if (
      normalizedExpectedRevision !== null &&
      normalizedExpectedRevision !== currentEntry.revision
    ) {
      return {
        ok: false,
        conflict: true,
        ...currentEntry,
      };
    }

    try {
      fs.rmSync(this.filePath, { force: true });
    } catch (error) {
      return this.writeEntry(null, {
        expectedRevision: currentEntry.revision,
      });
    }

    return {
      ok: true,
      conflict: false,
      ...createJsonStateStoreEntry(null, 0),
    };
  }

  clear(options = {}) {
    return this.clearEntry(options);
  }
}

module.exports = {
  FileJsonStateStore,
  MemoryJsonStateStore,
  createJsonStateStoreEntry,
  cloneJsonValue,
  isJsonStateStore,
};
