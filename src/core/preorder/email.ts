import "server-only";

import type { PublicPreorderConfirmation } from "./schemas";

export interface PreorderEmailAdapter {
  sendConfirmation(confirmation: PublicPreorderConfirmation): Promise<void>;
}

export class ConsolePreorderEmailAdapter implements PreorderEmailAdapter {
  async sendConfirmation(
    confirmation: PublicPreorderConfirmation,
  ): Promise<void> {
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

export function defaultPreorderEmailAdapter(): PreorderEmailAdapter {
  return new ConsolePreorderEmailAdapter();
}
