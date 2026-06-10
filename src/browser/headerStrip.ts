import type { BrowserContext } from "playwright";

/**
 * Strip ONLY the frame-busting response headers from the target app so it
 * loads inside the harness iframe. Everything else passes through untouched —
 * the browser still talks to the dev server directly (cookies, redirects and
 * HMR websockets are unaffected).
 */
export async function installHeaderStrip(
  context: BrowserContext,
  targetOrigins: string[],
): Promise<void> {
  await context.route(
    (url) => targetOrigins.includes(url.origin),
    async (route) => {
      // Only documents/frames can be frame-busted; let subresources flow.
      const type = route.request().resourceType();
      if (type !== "document") return route.continue();

      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["x-frame-options"];

      const csp = headers["content-security-policy"];
      if (csp) {
        // Surgically remove only the frame-ancestors directive.
        const stripped = csp
          .split(";")
          .filter((d) => !/^\s*frame-ancestors/i.test(d))
          .join(";")
          .trim();
        if (stripped) headers["content-security-policy"] = stripped;
        else delete headers["content-security-policy"];
      }

      await route.fulfill({ response, headers });
    },
  );
}
