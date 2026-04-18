const memoryStore = new Map();

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch (error) {
    error;
    return false;
  }
}

function getFallbackStorage() {
  if (canUseLocalStorage()) {
    return {
      getItem(key) {
        return window.localStorage.getItem(key);
      },
      setItem(key, value) {
        window.localStorage.setItem(key, value);
      },
      removeItem(key) {
        window.localStorage.removeItem(key);
      },
      clear() {
        window.localStorage.clear();
      },
      key(index) {
        return window.localStorage.key(index);
      },
    };
  }

  return {
    getItem(key) {
      return memoryStore.has(key) ? memoryStore.get(key) : null;
    },
    setItem(key, value) {
      memoryStore.set(key, value);
    },
    removeItem(key) {
      memoryStore.delete(key);
    },
    clear() {
      memoryStore.clear();
    },
    key(index) {
      return Array.from(memoryStore.keys())[index] ?? null;
    },
  };
}

function createAsyncStorage(adapter) {
  return {
    async get(key) {
      return adapter.getItem(key);
    },
    async set(key, value) {
      adapter.setItem(key, value);
    },
    async del(key) {
      adapter.removeItem(key);
    },
  };
}

export function constructClient() {
  const storage = getFallbackStorage();

  return {
    indexedDBKeyval: createAsyncStorage(storage),
    localStorage: {
      async setItem(key, value) {
        storage.setItem(key, value);
      },
      async getItem(key) {
        return storage.getItem(key);
      },
      async removeItem(key) {
        storage.removeItem(key);
      },
      async clear() {
        storage.clear();
      },
      async key(index) {
        return storage.key(index);
      },
    },
  };
}

export function initHub() {
  return {
    close() {},
  };
}

export default {
  constructClient,
  initHub,
};
