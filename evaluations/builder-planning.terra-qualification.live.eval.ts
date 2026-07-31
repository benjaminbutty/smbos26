import { runLiveBuilderTerraQualification } from "../src/ai/evaluation/live";
import { builderEvaluationTopLevelFailureSchema } from "../src/ai/evaluation/schemas";

try {
  const result = await runLiveBuilderTerraQualification({
    RUN_LIVE_OPENAI_TERRA_QUALIFICATION:
      process.env.RUN_LIVE_OPENAI_TERRA_QUALIFICATION,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  if (!result.ran) {
    console.log("Live GPT-5.6 Terra qualification not run.");
  } else if (!result.passed) {
    process.exitCode = 1;
  }
} catch {
  console.log(
    JSON.stringify(
      builderEvaluationTopLevelFailureSchema.parse({
        evaluation_error_code: "evaluation_setup_failed",
      }),
    ),
  );
  process.exitCode = 1;
}
