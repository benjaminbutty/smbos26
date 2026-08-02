import {
  configurationDraftingTopLevelFailure,
  runLiveConfigurationDraftingReliability,
} from "../src/ai/evaluation/configuration-drafting/live";

try {
  const environment = {
    RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY:
      process.env.RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_RELIABILITY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  const result = await runLiveConfigurationDraftingReliability(environment);
  if (!result.ran) {
    console.log(
      "Live GPT-5.6 Terra configuration-drafting reliability not run.",
    );
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify(configurationDraftingTopLevelFailure()));
  process.exitCode = 1;
}
