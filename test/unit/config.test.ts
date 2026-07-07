import { describe, it, expect } from "vitest";
import { configSchema, resolveUrl } from "../../src/config/schema.js";

describe("config schema", () => {
  it("applies defaults", () => {
    const config = configSchema.parse({
      devCommand: "npm run dev",
      url: "http://localhost:{port}",
    });
    expect(config.gif).toEqual({
      width: 900,
      fps: 24,
      quality: "high",
      maxColors: 256,
      interpolate: "blend",
      smoothFps: 60,
    });
    expect(config.resetStorage).toBe(true);
    expect(config.passes).toBe(2);
    expect(config.viewport).toEqual({ width: 1920, height: 1080 });
    expect(config.headerStrip).toBe(true);
    expect(config.output).toBe(".pr-preview/output");
  });

  it("rejects a missing devCommand", () => {
    expect(configSchema.safeParse({ url: "http://localhost:3000" }).success).toBe(false);
  });

  it("templates {port} into the url", () => {
    const config = configSchema.parse({
      devCommand: "npm run dev",
      url: "http://localhost:{port}",
    });
    expect(resolveUrl(config, 4444)).toBe("http://localhost:4444");
  });

  it("leaves fixed urls untouched", () => {
    const config = configSchema.parse({
      devCommand: "npm run dev",
      url: "http://localhost:3000",
    });
    expect(resolveUrl(config, 4444)).toBe("http://localhost:3000");
  });
});
