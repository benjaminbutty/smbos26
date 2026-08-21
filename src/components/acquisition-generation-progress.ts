export const acquisitionGenerationProgressStages = Object.freeze([
  Object.freeze({
    afterMs: 0,
    message: "Shaping your workspace…",
  }),
  Object.freeze({
    afterMs: 10_000,
    message: "Designing the parts and how they connect…",
  }),
  Object.freeze({
    afterMs: 30_000,
    message: "Checking the details and connections…",
  }),
  Object.freeze({
    afterMs: 45_000,
    message: "Finishing your workspace. This can take up to a minute.",
  }),
] as const);

export function acquisitionGenerationProgressMessage(
  elapsedMs: number,
): string {
  const boundedElapsedMs = Number.isFinite(elapsedMs)
    ? Math.max(0, elapsedMs)
    : 0;
  return acquisitionGenerationProgressStages.findLast(
    ({ afterMs }) => boundedElapsedMs >= afterMs,
  )!.message;
}
