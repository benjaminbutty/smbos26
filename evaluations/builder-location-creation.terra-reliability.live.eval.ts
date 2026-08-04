import { runLiveBuilderLocationCreationReliability } from "../src/ai/evaluation/location-creation-intent/live";

try {
  const result = await runLiveBuilderLocationCreationReliability({
    RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_RELIABILITY:
      process.env.RUN_LIVE_OPENAI_LOCATION_CREATION_TERRA_RELIABILITY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live GPT-5.6 Terra Location-creation reliability not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log('{"evaluation_error_code":"evaluation_setup_failed"}');
  process.exitCode = 1;
}
