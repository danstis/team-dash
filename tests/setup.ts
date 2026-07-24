import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const server = setupServer();
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    writable: true,
    configurable: true,
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
