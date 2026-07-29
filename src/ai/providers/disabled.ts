import "server-only";

import {
  StructuredAiProviderError,
  type StructuredAiProvider,
} from "../contracts";

export class DisabledStructuredAiProvider implements StructuredAiProvider {
  async generateStructured(): Promise<never> {
    throw new StructuredAiProviderError(
      "disabled",
      "No structured AI provider is configured.",
    );
  }
}
