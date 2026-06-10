import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Journey, Step } from "./types.js";

const stepSchema: z.ZodType<Step> = z.object({
  id: z.string(),
  type: z.enum(["click", "fill", "select", "press", "scroll", "navigate", "wait"]),
  selectors: z.array(z.string()).optional(),
  coordinates: z.object({ xNorm: z.number(), yNorm: z.number() }).optional(),
  frameUrl: z.string().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  scrollTarget: z.string().optional(),
  scroll: z.object({ xNorm: z.number(), yNorm: z.number() }).optional(),
  url: z.string().optional(),
  causesNavigation: z.boolean().optional(),
  label: z.string().optional(),
  timestamp: z.number(),
  thumbnail: z.string().optional(),
});

const journeySchema: z.ZodType<Journey> = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  baseRef: z.string().optional(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
    deviceScaleFactor: z.number(),
  }),
  startUrl: z.string(),
  steps: z.array(stepSchema),
});

export async function loadJourney(file: string): Promise<Journey> {
  const raw = JSON.parse(await readFile(file, "utf8"));
  const parsed = journeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid journey file ${file}: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/** Persist a journey — sidebar thumbnails never hit disk. */
export async function saveJourney(file: string, journey: Journey): Promise<void> {
  const clean: Journey = {
    ...journey,
    steps: journey.steps.map((s) => {
      const { thumbnail: _thumbnail, ...rest } = s;
      return rest;
    }),
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(clean, null, 2) + "\n");
}
