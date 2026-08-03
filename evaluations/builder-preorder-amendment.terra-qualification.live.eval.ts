import { runLiveBuilderPreorderAmendmentQualification } from "../src/ai/evaluation/preorder-amendment/live";

try {
  const result = await runLiveBuilderPreorderAmendmentQualification({
    RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION:
      process.env.RUN_LIVE_OPENAI_PREORDER_AMENDMENT_QUALIFICATION,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live GPT-5.6 Terra preorder-amendment qualification not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log('{"evaluation_error_code":"evaluation_setup_failed"}');
  process.exitCode = 1;
}
