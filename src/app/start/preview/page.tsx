import { redirect } from "next/navigation";

import { loadAcquisitionSession } from "../../../core/acquisition/service";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function CandidatePreviewIndexPage(): Promise<never> {
  const session = await loadAcquisitionSession();
  if (!session?.payload) {
    redirect(
      "/start?error=Prepare a starting point before opening preview.&state=detail",
    );
  }
  redirect("/start/preview/home");
}
