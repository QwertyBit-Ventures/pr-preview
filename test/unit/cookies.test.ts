import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { readCookiesFile } from "../../src/browser/cookies.js";

const write = (content: string) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cookies-")), "cookies.json");
  writeFileSync(file, content);
  return file;
};

describe("cookies file", () => {
  it("is optional: no file, no cookies", () => {
    expect(readCookiesFile(undefined)).toEqual([]);
    expect(readCookiesFile("")).toEqual([]);
  });

  it("reads Playwright's addCookies shape", () => {
    const cookies = [{ name: "session", value: "abc", domain: "localhost", path: "/", sameSite: "Lax" }];
    expect(readCookiesFile(write(JSON.stringify(cookies)))).toEqual(cookies);
  });

  it("says so when the file is missing or is not a list, instead of recording signed out", () => {
    expect(() => readCookiesFile("/nonexistent/cookies.json")).toThrow(/does not exist/);
    expect(() => readCookiesFile(write('{"name":"session"}'))).toThrow(/not a JSON array/);
  });
});
