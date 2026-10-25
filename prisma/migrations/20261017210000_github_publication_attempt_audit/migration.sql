-- Claim audit commits with its lease/dispatch marker, before any provider HTTP.
ALTER TYPE "AuditAction" ADD VALUE 'GITHUB_CHECK_CLAIMED';
