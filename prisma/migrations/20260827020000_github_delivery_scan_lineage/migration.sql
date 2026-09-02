-- Additive GitHub webhook-to-scan lineage. Existing deliveries remain valid with a NULL scanId.
ALTER TABLE "GitHubWebhookDelivery" ADD COLUMN "scanId" TEXT;

CREATE INDEX "GitHubWebhookDelivery_organizationId_scanId_idx"
  ON "GitHubWebhookDelivery"("organizationId", "scanId");

ALTER TABLE "GitHubWebhookDelivery"
  ADD CONSTRAINT "GitHubWebhookDelivery_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

