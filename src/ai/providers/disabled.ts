import "server-only";

import {
  StructuredAiProviderError,
  type StructuredAiProvider,
} from "../contracts";

export class DisabledStructuredAiProvider implements StructuredAiProvider {
  readonly key = "disabled";

  async generateStructured(): Promise<never> {
    throw new StructuredAiProviderError(
      "disabled",
      "No structured AI provider is configured.",
      { usage: { inputTokens: 0, outputTokens: 0 } },
    );
  }
}
