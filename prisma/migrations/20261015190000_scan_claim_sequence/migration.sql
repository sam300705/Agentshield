-- Count claims monotonically from this upgrade. Historical attempts are not reconstructed.
ALTER TABLE "ScanJob" ADD COLUMN "claimSequence" INTEGER NOT NULL DEFAULT 0;
