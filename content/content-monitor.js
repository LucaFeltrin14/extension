(() => {
  'use strict';

  const browserApi = typeof browser !== 'undefined' ? browser : chrome;
  const MAX_CANVAS_EVENTS = 5;
  let canvasEvents = 0;

  const debounce = (fn, wait) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), wait);
    };
  };

  const safeSendMessage = (payload) => {
    try {
      browserApi.runtime.sendMessage(payload).catch(() => {});
    } catch (error) {
      // Ignora erros em contextos sem privilégios
    }
  };

  const collectStorageSnapshot = async () => {
    const local = readStorageSafely(() => window.localStorage);
    const session = readStorageSafely(() => window.sessionStorage);
    const indexedDBInfo = await collectIndexedDb();

    safeSendMessage({
      type: 'storageSnapshot',
      payload: {
        local,
        session,
        indexedDB: indexedDBInfo
      }
    });
  };

  const debouncedSnapshot = debounce(() => {
    collectStorageSnapshot();
  }, 750);

  function collectIndexedDb() {
    try {
      if (!('indexedDB' in window)) {
        return Promise.resolve({ databases: 0 });
      }
      const fn = window.indexedDB.databases;
      if (typeof fn !== 'function') {
        return Promise.resolve({ databases: 'unknown' });
      }
      return fn.call(window.indexedDB).then((databases) => ({ databases: databases.length }))
        .catch(() => ({ databases: 'unknown' }));
    } catch (error) {
      return Promise.resolve({ databases: 'unknown' });
    }
  }

  function readStorageSafely(getter) {
    try {
      const storage = getter();
      if (!storage) {
        return { entries: 0, size: 0 };
      }
      let entries = 0;
      let size = 0;
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        let length = 0;
        try {
          const value = storage.getItem(key);
          if (value) {
            length = value.length;
          }
        } catch (error) {
          // Ignora itens inacessíveis
        }
        entries += 1;
        size += key.length + length;
        keys.push({ key, valueLength: length });
      }
      return { entries, size, keys };
    } catch (error) {
      return { entries: 'inacessível', size: 0 };
    }
  }

  function instrumentStorage(storageName) {
    try {
      const storage = window[storageName];
      if (!storage) return;
      const originalSetItem = storage.setItem.bind(storage);
      const originalRemoveItem = storage.removeItem.bind(storage);
      const originalClear = storage.clear.bind(storage);

      storage.setItem = function wrappedSetItem(key, value) {
        originalSetItem(key, value);
        debouncedSnapshot();
      };

      storage.removeItem = function wrappedRemoveItem(key) {
        originalRemoveItem(key);
        debouncedSnapshot();
      };

      storage.clear = function wrappedClear() {
        originalClear();
        debouncedSnapshot();
      };
    } catch (error) {
      // Ignora se não pudermos instrumentar
    }
  }

  function instrumentCanvas(methodName, targetPrototype) {
    const proto = targetPrototype;
    if (!proto || typeof proto[methodName] !== 'function') {
      return;
    }
    const original = proto[methodName];
    proto[methodName] = function wrappedCanvasMethod(...args) {
      if (canvasEvents < MAX_CANVAS_EVENTS) {
        canvasEvents += 1;
        safeSendMessage({
          type: 'canvasFingerprint',
          payload: {
            method: `${proto.constructor.name}.${methodName}`,
            stack: new Error().stack
          }
        });
      }
      return original.apply(this, args);
    };
  }

  function init() {
    instrumentStorage('localStorage');
    instrumentStorage('sessionStorage');

    instrumentCanvas('toDataURL', window.HTMLCanvasElement && window.HTMLCanvasElement.prototype);
    instrumentCanvas('toBlob', window.HTMLCanvasElement && window.HTMLCanvasElement.prototype);
    instrumentCanvas('getImageData', window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype);

    debouncedSnapshot();

    if (document.readyState === 'complete') {
      collectStorageSnapshot();
    } else {
      window.addEventListener('load', () => {
        collectStorageSnapshot();
      });
    }
  }

  init();
})();

