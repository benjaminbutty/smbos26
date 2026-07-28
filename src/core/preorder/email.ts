import "server-only";

import type { PublicPreorderConfirmation } from "./schemas";

export interface PreorderEmailAdapter {
  sendConfirmation(confirmation: PublicPreorderConfirmation): Promise<void>;
}

export class ConsolePreorderEmailAdapter implements PreorderEmailAdapter {
  constructor(
    private readonly environment: string | undefined = process.env.NODE_ENV,
  ) {}

  async sendConfirmation(
    confirmation: PublicPreorderConfirmation,
  ): Promise<void> {
    if (!["development", "test"].includes(this.environment ?? "")) {
      throw new Error(
        "The console preorder email adapter is available only locally.",
      );
    }

    console.info(
      "[SMBOS local confirmation email]",
      JSON.stringify({
        to: confirmation.confirmation_email,
        subject: `Preorder ${confirmation.public_reference} confirmed`,
        collection: {
          location: confirmation.collection_location,
          at: confirmation.collection_at,
          timezone: confirmation.timezone,
        },
        items: confirmation.items,
        total: confirmation.total,
      }),
    );
  }
}

export class UnconfiguredPreorderEmailAdapter implements PreorderEmailAdapter {
  async sendConfirmation(): Promise<void> {
    throw new Error("No production preorder email provider is configured.");
  }
}

export function defaultPreorderEmailAdapter(
  environment: string | undefined = process.env.NODE_ENV,
): PreorderEmailAdapter {
  return ["development", "test"].includes(environment ?? "")
    ? new ConsolePreorderEmailAdapter(environment)
    : new UnconfiguredPreorderEmailAdapter();
}
