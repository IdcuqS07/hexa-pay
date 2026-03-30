import * as naclModule from "tweetnacl/nacl-fast.js";

const nacl =
  naclModule.box
    ? naclModule
    : naclModule.default?.box
      ? naclModule.default
      : globalThis.nacl ||
        globalThis.self?.nacl ||
        globalThis.window?.nacl;

if (!nacl?.box || typeof nacl.randomBytes !== "function") {
  throw new Error("tweetnacl browser interop failed.");
}

export const box = nacl.box;
export const randomBytes = nacl.randomBytes;
export default nacl;
