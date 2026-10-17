-- Preserve every existing row. History already overwritten by older code cannot be reconstructed.
DROP INDEX "Advisory_organizationId_advisoryId_packageName_version_key";
CREATE UNIQUE INDEX "Advisory_scan_observation_key"
  ON "Advisory" ("organizationId", "scanId", "ecosystem", "advisoryId", "packageName", "version");
