-- GitHub Check IDs exceed PostgreSQL INTEGER range. Retain identifiers losslessly.
ALTER TABLE "GitHubCheckPublication" ALTER COLUMN "checkRunId" TYPE TEXT USING "checkRunId"::text;
