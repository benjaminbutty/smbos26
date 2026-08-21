import "server-only";

import {
  aiServiceTierSchema,
  type AiServiceTier,
  type StructuredAiProvider,
} from "../contracts";
import {
  createOpenAiResponsesClient,
  OpenAiResponsesStructuredProvider,
  type OpenAiResponsesClient,
} from "./openai";

export type OpenAiLatencyDiagnosticObservation = {
  providerElapsedMs: number | null;
  effectiveServiceTier: AiServiceTier | null;
  responseReturned: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function effectiveServiceTierFromRawResponse(
  response: unknown,
): AiServiceTier | null {
  if (!isRecord(response)) return null;
  const parsed = aiServiceTierSchema.safeParse(response.service_tier);
  return parsed.success ? parsed.data : null;
}

/**
 * Evaluation-only provider observation. It retains only elapsed time and the
 * bounded effective service tier; request bodies and raw responses are never
 * emitted or persisted.
 */
export function createObservedOpenAiResponsesStructuredProvider(
  apiKey: string,
  observations: OpenAiLatencyDiagnosticObservation[],
): StructuredAiProvider {
  const baseClient = createOpenAiResponsesClient(apiKey);
  const observedClient: OpenAiResponsesClient = {
    responses: {
      async create(body, options): Promise<unknown> {
        void body;
        const observation: OpenAiLatencyDiagnosticObservation = {
          providerElapsedMs: null,
          effectiveServiceTier: null,
          responseReturned: false,
        };
        observations.push(observation);
        const startedAt = performance.now();
        try {
          const response = await baseClient.responses.create(body, options);
          observation.responseReturned = true;
          observation.effectiveServiceTier =
            effectiveServiceTierFromRawResponse(response);
          return response;
        } finally {
          observation.providerElapsedMs = Math.max(
            0,
            Math.round(performance.now() - startedAt),
          );
        }
      },
    },
  };
  return new OpenAiResponsesStructuredProvider({ client: observedClient });
}
