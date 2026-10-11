// Run focused production tests with --require this file: no configured DB or network can be reached.
const Module = require('node:module');
const path = require('node:path');
const target = path.resolve(__dirname, '../../dist/db/prisma.js');
const blocked = name => () => { throw new Error(`Offline test reached an unstubbed dependency: ${name}`); };
const models = new Map();
const prisma = new Proxy({}, {
  get(object, key) {
    if (Object.hasOwn(object, key)) return object[key];
    if (typeof key !== 'string') return undefined;
    if (key.startsWith('$')) return (object[key] = blocked(`prisma.${key}`));
    if (!models.has(key)) models.set(key, new Proxy({}, {
      get(model, method) { return model[method] ?? (model[method] = blocked(`prisma.${key}.${String(method)}`)); },
    }));
    return models.get(key);
  },
});
const originalLoad = Module._load;
Module._load = function(id, parent, ...rest) {
  if (Module._resolveFilename(id, parent) === target) return { prisma };
  return originalLoad.call(this, id, parent, ...rest);
};
global.fetch = blocked('fetch');
require('node:http').request = blocked('http.request');
require('node:https').request = blocked('https.request');
require('node:net').Socket.prototype.connect = blocked('socket.connect');
