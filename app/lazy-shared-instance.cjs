'use strict';

function createLazySharedInstance(factory) {
  if (typeof factory !== 'function') {
    throw new TypeError('factory must be a function');
  }

  let instance = null;

  function getInstance() {
    if (!instance) {
      instance = factory();
    }

    return instance;
  }

  const shared = new Proxy(function lazySharedInstance() {}, {
    apply(_target, thisArg, args) {
      return Reflect.apply(getInstance(), thisArg, args);
    },
    construct(_target, args, newTarget) {
      return Reflect.construct(getInstance(), args, newTarget);
    },
    defineProperty(_target, property, descriptor) {
      Object.defineProperty(getInstance(), property, descriptor);
      return true;
    },
    deleteProperty(_target, property) {
      return delete getInstance()[property];
    },
    get(_target, property) {
      if (property === '__getInstance') {
        return getInstance;
      }

      const value = getInstance()[property];
      return typeof value === 'function' ? value.bind(getInstance()) : value;
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(getInstance(), property);
      if (!descriptor) {
        return descriptor;
      }

      return {
        ...descriptor,
        configurable: true,
      };
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(getInstance());
    },
    has(_target, property) {
      return property in getInstance();
    },
    isExtensible() {
      return Object.isExtensible(getInstance());
    },
    ownKeys() {
      return Reflect.ownKeys(getInstance());
    },
    preventExtensions() {
      Object.preventExtensions(getInstance());
      return true;
    },
    set(_target, property, value) {
      getInstance()[property] = value;
      return true;
    },
    setPrototypeOf(_target, prototype) {
      Object.setPrototypeOf(getInstance(), prototype);
      return true;
    },
  });

  return {
    getInstance,
    shared,
  };
}

module.exports = {
  createLazySharedInstance,
};
