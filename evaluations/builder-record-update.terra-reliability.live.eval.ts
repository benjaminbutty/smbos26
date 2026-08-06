import { runLiveBuilderRecordUpdateReliability } from "../src/ai/evaluation/record-update-intent/live";

try {
  const result = await runLiveBuilderRecordUpdateReliability({
    RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_RELIABILITY:
      process.env.RUN_LIVE_OPENAI_RECORD_UPDATE_TERRA_RELIABILITY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live GPT-5.6 Terra Record-update reliability not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log('{"evaluation_error_code":"evaluation_setup_failed"}');
  process.exitCode = 1;
}
