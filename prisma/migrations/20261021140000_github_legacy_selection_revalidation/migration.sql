-- Earlier synchronizers retained repositories absent from later provider snapshots.
-- Their legacy selection cannot be inferred from a retained installation link.
-- Preserve every row and require fresh trusted synchronization before admission.
UPDATE "Repository" SET "githubAccessible" = false WHERE "provider" = 'GITHUB';
