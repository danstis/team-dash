import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll } from "vitest";

import {
  resetServer,
  server,
  startServer,
  stopServer,
} from "../src/mocks/server";

export { server };

if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}

beforeAll(() => {
  startServer();
});

afterEach(() => {
  resetServer();
});

afterAll(() => {
  stopServer();
});
