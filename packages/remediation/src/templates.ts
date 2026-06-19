import { type Finding, type PolicyDecisionType } from "@agentshield/schemas";

type RemediableDecision = Extract<PolicyDecisionType, "BLOCK" | "REQUIRE_APPROVAL">;

export interface SafeCodeSnippet {
  language: string;
  before?: string;
  after: string;
}

export interface RemediationTemplate {
  id: string;
  summary: string;
  explanation: string;
  prComment: string;
  fixSuggestion: string;
  steps: string[];
  generatedForDecision: RemediableDecision;
  safeCodeSnippet?: SafeCodeSnippet;
}

export const SPECIFIC_REMEDIATION_TEMPLATES: Record<string, RemediationTemplate> = {
  "secret.aws_access_key_id": {
    id: "secret.aws_access_key_id",
    summary: "Remove the hardcoded AWS access key and rotate the credential.",
    explanation:
      "AgentShield detected a potential hardcoded AWS access key. Secrets must not be committed to source code because repository history, forks, CI logs, and build artifacts can preserve the value after removal.",
    prComment:
      "AgentShield detected a potential hardcoded secret. Secrets must be injected via environment variables, a CI/CD secret store, or a managed secret manager. Remove this value from the repository and rotate it before merging.",
    fixSuggestion:
      "Replace the literal credential with a documented environment variable placeholder and load the real value from your deployment secret store.",
    steps: [
      "Remove the literal AWS key from the file.",
      "Rotate the credential if it was ever real or copied from a real environment.",
      "Reference the secret through your platform secret manager or CI/CD secret store.",
      "Confirm repository history and build logs do not expose the credential.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "dotenv",
      before: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      after: "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}",
    },
  },
  "secret.aws_secret_access_key": {
    id: "secret.aws_secret_access_key",
    summary: "Remove the hardcoded AWS secret access key and rotate it.",
    explanation:
      "AgentShield detected a potential AWS secret access key. A committed cloud secret can allow unauthorized access even if the pull request is never merged.",
    prComment:
      "AgentShield detected a high-confidence cloud secret. Remove it from source control, rotate the credential, and inject the value at runtime through a secret manager.",
    fixSuggestion:
      "Use a secret reference instead of embedding the secret value in the repository.",
    steps: [
      "Delete the hardcoded AWS secret access key from the file.",
      "Rotate the corresponding AWS access key pair.",
      "Store the real secret in a managed secret store.",
      "Use a non-sensitive placeholder in examples and documentation.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "dotenv",
      before: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      after: "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}",
    },
  },
  "secret.github_token": {
    id: "secret.github_token",
    summary: "Remove the hardcoded GitHub token and revoke it.",
    explanation:
      "AgentShield detected a GitHub token-like value. Source-control tokens can grant repository, package, or organization access and must be treated as compromised once committed.",
    prComment:
      "AgentShield detected a GitHub token-like secret. Revoke the token, remove it from the repository, and replace it with a CI secret reference.",
    fixSuggestion:
      "Configure the token in your CI provider or secret manager and reference it by environment variable.",
    steps: [
      "Remove the token-like value from the file.",
      "Revoke or rotate the token in GitHub.",
      "Replace usage with an environment variable reference.",
      "Limit the replacement token to the minimum scopes needed.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "dotenv",
      before: "GITHUB_TOKEN=ghp_111111111111111111111111111111111111",
      after: "GITHUB_TOKEN=${GITHUB_TOKEN}",
    },
  },
  "secret.stripe_live_key": {
    id: "secret.stripe_live_key",
    summary: "Remove the hardcoded Stripe live secret key and rotate it.",
    explanation:
      "AgentShield detected a Stripe live secret key-like value. Payment provider secrets must never be committed because they can authorize sensitive account operations.",
    prComment:
      "AgentShield detected a payment provider secret. Remove it, rotate the key, and load it through a secret manager or deployment environment.",
    fixSuggestion:
      "Use an environment variable placeholder and configure the live key outside source control.",
    steps: [
      "Remove the Stripe live key-like value from the repository.",
      "Rotate the key in the Stripe dashboard if it was ever real.",
      "Inject the replacement value through deployment configuration.",
      "Use test-mode placeholders only in committed examples.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "dotenv",
      before: "STRIPE_SECRET_KEY=sk_live_...",
      after: "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}",
    },
  },
  "secret.explicit_generic_key": {
    id: "secret.explicit_generic_key",
    summary: "Replace the hardcoded secret-like value with a runtime secret reference.",
    explanation:
      "AgentShield detected an explicit key, token, or secret assignment. Even generic-looking secrets should be handled as sensitive until proven otherwise.",
    prComment:
      "AgentShield detected a hardcoded secret-like assignment. Remove the literal value and inject it at runtime through approved configuration.",
    fixSuggestion:
      "Use a placeholder in committed examples and document the required environment variable.",
    steps: [
      "Remove the hardcoded key, token, or secret value.",
      "Determine whether the value was real and rotate it if needed.",
      "Load the value from a secret manager, CI/CD secret, or deployment environment.",
      "Keep example values obviously fake and non-sensitive.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "dotenv",
      before: "API_KEY=hardcoded-demo-api-key",
      after: "API_KEY=${API_KEY}",
    },
  },
  "dockerfile.from_latest": {
    id: "dockerfile.from_latest",
    summary: "Pin the Docker base image to a specific version or digest.",
    explanation:
      "Using the 'latest' tag makes builds non-reproducible because the image can change without a source-code change. This weakens supply-chain traceability and rollback confidence.",
    prComment:
      "AgentShield detected a Docker base image using the 'latest' tag. Pin to a specific version tag or immutable digest before this change is merged.",
    fixSuggestion:
      "Replace the mutable tag with a supported, explicit version such as node:20.11-alpine or an image digest approved by the platform team.",
    steps: [
      "Choose a supported Node.js base image version.",
      "Replace the latest tag with an explicit version tag or digest.",
      "Rebuild the image and run tests against the pinned base.",
      "Track base image upgrades as deliberate dependency changes.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "dockerfile",
      before: "FROM node:latest",
      after: "FROM node:20.11-alpine",
    },
  },
  "dockerfile.missing_user": {
    id: "dockerfile.missing_user",
    summary: "Add a non-root runtime user to the Dockerfile.",
    explanation:
      "A Dockerfile without an explicit non-root USER instruction may run with unsafe base-image defaults. Containers should run with the minimum privileges needed by the workload.",
    prComment:
      "AgentShield did not find a non-root Docker USER instruction. Add a dedicated runtime user and switch to it before the final command.",
    fixSuggestion:
      "Create a locked-down application user and place `USER appuser` before the runtime command.",
    steps: [
      "Create a dedicated runtime group and user.",
      "Ensure application files are owned by that user.",
      "Switch to the non-root user before CMD or ENTRYPOINT.",
      "Run the container locally to confirm file permissions are correct.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "dockerfile",
      after: "RUN addgroup -S app && adduser -S appuser -G app\nUSER appuser",
    },
  },
  "kubernetes.privileged_container": {
    id: "kubernetes.privileged_container",
    summary: "Disable privileged mode for the Kubernetes container.",
    explanation:
      "Running privileged containers allows broad host access and can bypass normal container isolation. This setting should be reserved for exceptional infrastructure workloads with explicit platform approval.",
    prComment:
      "AgentShield detected `privileged: true`. Set `privileged: false` unless this workload has a documented platform exception.",
    fixSuggestion:
      "Remove privileged mode and grant only the specific Linux capabilities the workload actually requires.",
    steps: [
      "Set `securityContext.privileged` to `false` or remove the field.",
      "Drop unnecessary Linux capabilities.",
      "Run the workload in a staging namespace to validate behavior.",
      "Document any required exception before requesting approval.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "yaml",
      before: "securityContext:\n  privileged: true",
      after: "securityContext:\n  privileged: false\n  allowPrivilegeEscalation: false",
    },
  },
  "kubernetes.allow_privilege_escalation": {
    id: "kubernetes.allow_privilege_escalation",
    summary: "Disable privilege escalation in the Kubernetes security context.",
    explanation:
      "Allowing privilege escalation lets a process gain more privileges than its parent process. This increases blast radius if the workload is compromised.",
    prComment:
      "AgentShield detected `allowPrivilegeEscalation: true`. Set this to `false` and validate that the workload still runs correctly.",
    fixSuggestion:
      "Set `allowPrivilegeEscalation: false` in the container security context.",
    steps: [
      "Change `allowPrivilegeEscalation` to `false`.",
      "Confirm the container does not require setuid or similar escalation behavior.",
      "Run integration tests in a staging cluster.",
      "Document any exception request with the platform team.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "yaml",
      before: "securityContext:\n  allowPrivilegeEscalation: true",
      after: "securityContext:\n  allowPrivilegeEscalation: false",
    },
  },
  "kubernetes.host_path_volume": {
    id: "kubernetes.host_path_volume",
    summary: "Replace the hostPath volume with a safer Kubernetes volume type.",
    explanation:
      "hostPath volumes can expose the node filesystem to the workload. This should require platform review because it expands the trust boundary from the pod to the node.",
    prComment:
      "AgentShield detected a `hostPath` volume. Replace it with a ConfigMap, Secret, PVC, or projected volume unless node filesystem access is strictly required and approved.",
    fixSuggestion:
      "Use a purpose-built Kubernetes volume type and narrow the mount to only the data the workload needs.",
    steps: [
      "Identify why the workload needs host filesystem access.",
      "Replace hostPath with a safer volume type where possible.",
      "If hostPath is unavoidable, mount the narrowest path as read-only.",
      "Request platform-owner approval with the operational justification.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "yaml",
      before: "volumes:\n  - name: host-root\n    hostPath:\n      path: /",
      after: "volumes:\n  - name: app-config\n    configMap:\n      name: app-config",
    },
  },
  "agent_workflow.remote_script_pipe_shell": {
    id: "agent_workflow.remote_script_pipe_shell",
    summary: "Replace curl-to-shell execution with a verified, pinned installation step.",
    explanation:
      "AI-agent workflows that pipe remote content into a shell execute code before review and without integrity verification. This is a high-risk software supply-chain pattern.",
    prComment:
      "AgentShield detected an AI-agent command that pipes network content into a shell. Replace it with a pinned artifact, checksum verification, or a reviewed script committed to the repository.",
    fixSuggestion:
      "Download a pinned artifact, verify its checksum, and execute only reviewed local scripts.",
    steps: [
      "Remove the curl-to-shell command from the workflow.",
      "Pin the artifact version or script revision.",
      "Verify checksums or signatures before execution.",
      "Prefer reviewed repository scripts over dynamic remote execution.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "bash",
      before: "curl -fsSL https://example.invalid/bootstrap.sh | bash",
      after: "curl -fsSLo bootstrap.sh https://example.invalid/bootstrap.sh\nsha256sum -c bootstrap.sh.sha256\nbash ./bootstrap.sh",
    },
  },
  "agent_workflow.chmod_777": {
    id: "agent_workflow.chmod_777",
    summary: "Replace chmod 777 with least-privilege file permissions.",
    explanation:
      "World-writable permissions allow any local process to modify files. In build and agent workflows this can allow tampering before tests, packaging, or deployment.",
    prComment:
      "AgentShield detected `chmod 777`. Replace it with the narrowest permission set needed by the workflow.",
    fixSuggestion:
      "Use owner/group-specific permissions such as `chmod 750` for directories or `chmod 640` for files.",
    steps: [
      "Identify which user or group needs access.",
      "Replace world-writable permissions with owner/group permissions.",
      "Avoid recursive permission changes unless the path is tightly scoped.",
      "Re-run the workflow to confirm the narrower permissions are sufficient.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "bash",
      before: "chmod -R 777 .",
      after: "chmod -R u=rwX,g=rX,o= .",
    },
  },
  "agent_workflow.read_env_file": {
    id: "agent_workflow.read_env_file",
    summary: "Prevent AI-agent workflows from reading environment files.",
    explanation:
      "Environment files often contain local credentials, tokens, or deployment secrets. AI-agent sessions should not read them unless a human has explicitly approved the access.",
    prComment:
      "AgentShield detected an AI-agent workflow reading `.env`. Remove this action and provide the agent with a sanitized example file instead.",
    fixSuggestion:
      "Use `.env.example` with fake values for context and keep real `.env` files outside agent-readable paths.",
    steps: [
      "Remove the command or tool action that reads `.env`.",
      "Provide a sanitized `.env.example` file if configuration context is needed.",
      "Ensure `.env` is ignored by source control.",
      "Review any session transcript for leaked values.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
    safeCodeSnippet: {
      language: "bash",
      before: "cat .env",
      after: "cat .env.example",
    },
  },
  "agent_workflow.read_ssh_material": {
    id: "agent_workflow.read_ssh_material",
    summary: "Block AI-agent access to SSH key material.",
    explanation:
      "SSH keys can grant direct access to source control, servers, or deployment environments. AI-agent workflows must not read private SSH material.",
    prComment:
      "AgentShield detected AI-agent access to SSH material. Remove the access immediately and rotate any exposed key.",
    fixSuggestion:
      "Use short-lived deploy tokens or scoped CI credentials instead of exposing SSH key files to the agent.",
    steps: [
      "Remove the action that reads `~/.ssh` or key files.",
      "Rotate the affected SSH key if it may have been exposed.",
      "Replace key-based access with scoped, short-lived credentials where possible.",
      "Restrict agent filesystem access to the repository workspace.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "bash",
      before: "cat ~/.ssh/id_rsa",
      after: "# Do not expose SSH private keys to agent workflows.",
    },
  },
};

export const CATEGORY_REMEDIATION_TEMPLATES = {
  SECRET: {
    id: "category.secret.generic",
    summary: "Remove the hardcoded secret and rotate it if needed.",
    explanation:
      "AgentShield detected a potential hardcoded secret. Secrets must be injected via environment variables, CI/CD secrets, or a managed secret store instead of being committed to source code.",
    prComment:
      "AgentShield detected a potential hardcoded secret. Remove the literal value, rotate it if it was real, and replace it with a runtime secret reference.",
    fixSuggestion:
      "Replace the literal value with an environment variable reference and keep only fake placeholders in committed examples.",
    steps: [
      "Remove the secret-like value from source control.",
      "Rotate the value if it may be real.",
      "Use a secret manager or deployment environment variable.",
      "Keep example files sanitized with fake placeholders.",
    ],
    generatedForDecision: "BLOCK",
    safeCodeSnippet: {
      language: "dotenv",
      after: "SERVICE_TOKEN=${SERVICE_TOKEN}",
    },
  },
  DOCKERFILE: {
    id: "category.dockerfile.generic",
    summary: "Harden the Dockerfile according to platform container standards.",
    explanation:
      "AgentShield detected a Dockerfile pattern that can weaken build reproducibility or runtime isolation.",
    prComment:
      "AgentShield detected a Dockerfile risk. Please harden the image definition before merging.",
    fixSuggestion:
      "Pin base images, avoid remote shell execution, and run the container as a non-root user.",
    steps: [
      "Pin mutable image tags to explicit versions or digests.",
      "Avoid executing unverified remote scripts.",
      "Run the image with a dedicated non-root user.",
      "Rebuild and test the hardened image.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
  },
  KUBERNETES: {
    id: "category.kubernetes.generic",
    summary: "Harden the Kubernetes manifest before merge.",
    explanation:
      "AgentShield detected a Kubernetes configuration that can increase workload or cluster risk.",
    prComment:
      "AgentShield detected a Kubernetes manifest risk. Please reduce privileges and document any required exception.",
    fixSuggestion:
      "Prefer least-privilege security contexts, avoid host-level access, and define safe defaults.",
    steps: [
      "Review the workload security context.",
      "Remove unnecessary privileged settings and host access.",
      "Validate the manifest in a staging namespace.",
      "Document any exception for platform review.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
  },
  AGENT_WORKFLOW: {
    id: "category.agent_workflow.generic",
    summary: "Constrain the AI-agent workflow action.",
    explanation:
      "AgentShield detected an AI-agent workflow action that can expose secrets, weaken permissions, or execute unreviewed code.",
    prComment:
      "AgentShield detected a risky AI-agent workflow action. Remove it or replace it with an auditable, least-privilege alternative.",
    fixSuggestion:
      "Constrain agent file access and replace risky shell commands with reviewed, deterministic steps.",
    steps: [
      "Remove the risky agent action from the workflow.",
      "Use reviewed scripts and sanitized inputs.",
      "Limit agent access to only required files.",
      "Request human approval if the action is truly required.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
  },
  DEPENDENCY: {
    id: "category.dependency.generic",
    summary: "Review the dependency inventory item.",
    explanation:
      "AgentShield records dependency information as SBOM inventory. This remediation template is informational unless another policy decision requires action.",
    prComment:
      "AgentShield recorded a dependency inventory item. Confirm the dependency and version are intentional.",
    fixSuggestion:
      "Pin dependency ranges and keep dependency changes deliberate and reviewable.",
    steps: [
      "Confirm the dependency is required.",
      "Pin broad ranges where possible.",
      "Regenerate the lockfile after changes.",
      "Review the SBOM inventory diff.",
    ],
    generatedForDecision: "REQUIRE_APPROVAL",
  },
} satisfies Record<Finding["category"], RemediationTemplate>;

export const FALLBACK_REMEDIATION_TEMPLATE = {
  id: "fallback.generic",
  summary: "Review and remediate the AgentShield finding.",
  explanation:
    "AgentShield detected a security-relevant finding that does not yet have a specialized remediation template.",
  prComment:
    "AgentShield detected a finding that requires security review. Please assess the evidence and apply the safest fix before merging.",
  fixSuggestion:
    "Reduce privilege, remove sensitive data, pin mutable inputs, and prefer deterministic configuration changes.",
  steps: [
    "Review the finding evidence and affected file.",
    "Apply the least-privilege or most deterministic safe fix.",
    "Add tests or validation where feasible.",
    "Request security review if the risk cannot be removed.",
  ],
  generatedForDecision: "REQUIRE_APPROVAL",
} satisfies RemediationTemplate;

function readRuleId(finding: Finding): string | undefined {
  const ruleId = finding.evidence.ruleId;

  return typeof ruleId === "string" ? ruleId : undefined;
}

export function selectRemediationTemplate(finding: Finding): RemediationTemplate {
  const ruleId = readRuleId(finding);

  if (ruleId != null && SPECIFIC_REMEDIATION_TEMPLATES[ruleId] != null) {
    return SPECIFIC_REMEDIATION_TEMPLATES[ruleId];
  }

  return CATEGORY_REMEDIATION_TEMPLATES[finding.category] ?? FALLBACK_REMEDIATION_TEMPLATE;
}
