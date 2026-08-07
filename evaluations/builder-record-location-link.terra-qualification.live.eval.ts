import { runLiveBuilderRecordLocationLinkQualification } from "../src/ai/evaluation/record-location-link-intent/live";

try {
  const result = await runLiveBuilderRecordLocationLinkQualification({
    RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_QUALIFICATION:
      process.env.RUN_LIVE_OPENAI_RECORD_LOCATION_LINK_TERRA_QUALIFICATION,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live GPT-5.6 Terra Record-to-Location qualification not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log('{"evaluation_error_code":"evaluation_setup_failed"}');
  process.exitCode = 1;
}
