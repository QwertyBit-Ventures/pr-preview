import getPort, { portNumbers } from "get-port";

export interface PortPlan {
  harness: number;
  beforeApp: number;
  afterApp: number;
}

/** Allocate the ports a run needs up front so dev commands can be templated. */
export async function allocatePorts(): Promise<PortPlan> {
  // Test hook: PR_PREVIEW_PORTS="harness,before,after" pins all three.
  const pinned = process.env.PR_PREVIEW_PORTS?.split(",").map(Number);
  if (pinned?.length === 3 && pinned.every((p) => Number.isInteger(p) && p > 0)) {
    return { harness: pinned[0]!, beforeApp: pinned[1]!, afterApp: pinned[2]! };
  }
  const harness = await getPort({ port: portNumbers(4310, 4400) });
  const beforeApp = await getPort({ port: portNumbers(4401, 4500), exclude: [harness] });
  const afterApp = await getPort({
    port: portNumbers(4501, 4600),
    exclude: [harness, beforeApp],
  });
  return { harness, beforeApp, afterApp };
}
