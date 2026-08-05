import { runLiveBuilderRecordSchemaCompatibility } from "../src/ai/evaluation/record-creation-intent/schema-compatibility";

try {
  const result = await runLiveBuilderRecordSchemaCompatibility({
    RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY:
      process.env.RUN_LIVE_OPENAI_RECORD_CREATION_SCHEMA_COMPATIBILITY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live OpenAI Record-schema compatibility gate not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log('{"evaluation_error_code":"evaluation_setup_failed"}');
  process.exitCode = 1;
}
