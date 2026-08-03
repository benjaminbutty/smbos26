import {
  configurationDraftingTopLevelFailure,
  runLiveConfigurationDraftingQualification,
} from "../src/ai/evaluation/configuration-drafting/live";

try {
  const environment = {
    RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION:
      process.env.RUN_LIVE_OPENAI_CONFIGURATION_DRAFTING_QUALIFICATION,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  const result = await runLiveConfigurationDraftingQualification(environment);
  if (!result.ran) {
    console.log(
      "Live GPT-5.6 Terra configuration-drafting qualification not run.",
    );
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify(configurationDraftingTopLevelFailure()));
  process.exitCode = 1;
}
