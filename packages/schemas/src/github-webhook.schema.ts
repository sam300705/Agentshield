import { z } from "zod";

const login = z.string().min(1).max(100);
const repository = z.object({
  id: z.number().int().positive().safe().optional(),
  full_name: z.string().min(3).max(201),
  owner: z.object({ login }).optional(),
});
const base = z.object({
  installation: z.object({
    id: z.number().int().positive().safe(),
    account: z.object({ login, type: z.enum(["User", "Organization"]) }).optional(),
  }),
  organization: z.object({ login }).optional(),
  repository: repository.optional(),
  action: z.string().min(1).max(64).optional(),
});
const repositories = z
  .array(
    z.object({
      id: z.number().int().positive().safe(),
      full_name: z.string().min(3).max(201).optional(),
    }),
  )
  .max(10_000);

// Strip provider fields the lifecycle never consumes. Raw bytes are verified before parsing.
export const githubWebhookSchemas = {
  push: base.extend({
    repository,
    ref: z.string().min(1).max(256),
    after: z.string().min(1).max(64),
    deleted: z.boolean().optional(),
  }),
  pull_request: base.extend({
    repository,
    action: z.string().min(1).max(64),
    pull_request: z.object({
      number: z.number().int().positive().safe().optional(),
      head: z.object({ ref: z.string().min(1).max(256), sha: z.string().min(1).max(64) }),
    }),
  }),
  installation: base.extend({ repositories: repositories.optional() }),
  installation_repositories: base.extend({
    action: z.enum(["added", "removed"]),
    repositories_added: repositories.optional(),
    repositories_removed: repositories.optional(),
  }),
} as const;

export function parseGitHubWebhookPayload(event: string, value: unknown) {
  const schema = Object.hasOwn(githubWebhookSchemas, event)
    ? githubWebhookSchemas[event as keyof typeof githubWebhookSchemas]
    : base;
  return schema.parse(value);
}
