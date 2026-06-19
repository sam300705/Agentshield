import {
  type PolicyRule,
  type PolicyRuleDictionary,
  policyRuleDictionarySchema,
} from "@agentshield/schemas";

export const POLICY_RULE_VERSION = "2026.06.0";

const ruleDictionary = {
  "secret.critical.block": {
    id: "secret.critical.block",
    version: POLICY_RULE_VERSION,
    name: "Block critical secret findings",
    description: "Blocks critical secret findings produced by the scanner.",
    enabled: true,
    target: {
      categories: ["SECRET"],
      severities: ["CRITICAL"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "SECRET",
      },
      {
        field: "severity",
        operator: "EQUALS",
        value: "CRITICAL",
      },
    ],
    decision: "BLOCK",
    remediationEligible: true,
    rationale: "Critical secret signatures indicate immediate source-code exposure risk.",
    tags: ["secret", "block", "phase-0-required"],
  },
  "secret.private_key.block": {
    id: "secret.private_key.block",
    version: POLICY_RULE_VERSION,
    name: "Block private key material",
    description: "Blocks findings that identify private key blocks in source-controlled files.",
    enabled: true,
    target: {
      categories: ["SECRET"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "SECRET",
      },
      {
        field: "title",
        operator: "MATCHES_REGEX",
        value: "private\\s+key|BEGIN\\s+(RSA\\s+|OPENSSH\\s+|EC\\s+)?PRIVATE\\s+KEY",
      },
    ],
    decision: "BLOCK",
    remediationEligible: true,
    rationale: "Private key blocks in source code can allow direct impersonation or infrastructure access.",
    tags: ["secret", "private-key", "block", "phase-0-required"],
  },
  "kubernetes.privileged_container.block": {
    id: "kubernetes.privileged_container.block",
    version: POLICY_RULE_VERSION,
    name: "Block privileged Kubernetes containers",
    description: "Blocks Kubernetes manifests that enable privileged container execution.",
    enabled: true,
    target: {
      categories: ["KUBERNETES"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "KUBERNETES",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "kubernetes.privileged_container",
      },
    ],
    decision: "BLOCK",
    remediationEligible: true,
    rationale: "Privileged containers can bypass workload isolation and access host-level capabilities.",
    tags: ["kubernetes", "privileged", "block", "phase-0-required"],
  },
  "kubernetes.host_path.require_approval": {
    id: "kubernetes.host_path.require_approval",
    version: POLICY_RULE_VERSION,
    name: "Require approval for hostPath volumes",
    description: "Requires human approval when Kubernetes manifests mount hostPath volumes.",
    enabled: true,
    target: {
      categories: ["KUBERNETES"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "KUBERNETES",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "kubernetes.host_path_volume",
      },
    ],
    decision: "REQUIRE_APPROVAL",
    remediationEligible: true,
    rationale: "hostPath volumes can expose the node filesystem and require platform-owner review.",
    tags: ["kubernetes", "hostpath", "approval", "phase-0-required"],
  },
  "kubernetes.allow_privilege_escalation.block": {
    id: "kubernetes.allow_privilege_escalation.block",
    version: POLICY_RULE_VERSION,
    name: "Block Kubernetes privilege escalation",
    description: "Blocks Kubernetes manifests that allow privilege escalation.",
    enabled: true,
    target: {
      categories: ["KUBERNETES"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "KUBERNETES",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "kubernetes.allow_privilege_escalation",
      },
    ],
    decision: "BLOCK",
    remediationEligible: true,
    rationale: "Privilege escalation allows a process to gain more privileges than intended.",
    tags: ["kubernetes", "privilege-escalation", "block", "phase-0-required"],
  },
  "dockerfile.latest_tag.warn": {
    id: "dockerfile.latest_tag.warn",
    version: POLICY_RULE_VERSION,
    name: "Warn on Docker latest tags",
    description: "Warns when a Dockerfile uses a latest base image tag.",
    enabled: true,
    target: {
      categories: ["DOCKERFILE"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "DOCKERFILE",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "dockerfile.from_latest",
      },
    ],
    decision: "WARN",
    remediationEligible: false,
    rationale: "latest tags are mutable and reduce build reproducibility.",
    tags: ["dockerfile", "latest-tag", "warn", "phase-0-required"],
  },
  "dockerfile.missing_user.warn": {
    id: "dockerfile.missing_user.warn",
    version: POLICY_RULE_VERSION,
    name: "Warn on missing Docker USER instruction",
    description: "Warns when a Dockerfile does not declare a runtime USER instruction.",
    enabled: true,
    target: {
      categories: ["DOCKERFILE"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "DOCKERFILE",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "dockerfile.missing_user",
      },
    ],
    decision: "WARN",
    remediationEligible: false,
    rationale: "Missing USER instructions can leave containers running with unsafe defaults.",
    tags: ["dockerfile", "user", "warn", "phase-0-required"],
  },
  "agent_workflow.remote_script.require_approval": {
    id: "agent_workflow.remote_script.require_approval",
    version: POLICY_RULE_VERSION,
    name: "Require approval for AI-agent curl-to-shell commands",
    description: "Requires approval when an AI-agent workflow pipes network content into a shell.",
    enabled: true,
    target: {
      categories: ["AGENT_WORKFLOW"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "AGENT_WORKFLOW",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "agent_workflow.remote_script_pipe_shell",
      },
    ],
    decision: "REQUIRE_APPROVAL",
    remediationEligible: true,
    rationale: "AI-agent remote script execution must be reviewed before merge.",
    tags: ["agent-workflow", "curl-bash", "approval", "phase-0-required"],
  },
  "agent_workflow.chmod_777.require_approval": {
    id: "agent_workflow.chmod_777.require_approval",
    version: POLICY_RULE_VERSION,
    name: "Require approval for AI-agent chmod 777 commands",
    description: "Requires approval when an AI-agent workflow applies world-writable permissions.",
    enabled: true,
    target: {
      categories: ["AGENT_WORKFLOW"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "AGENT_WORKFLOW",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "agent_workflow.chmod_777",
      },
    ],
    decision: "REQUIRE_APPROVAL",
    remediationEligible: true,
    rationale: "World-writable permission changes can weaken repository and build security.",
    tags: ["agent-workflow", "permissions", "approval", "phase-0-required"],
  },
  "agent_workflow.read_env.require_approval": {
    id: "agent_workflow.read_env.require_approval",
    version: POLICY_RULE_VERSION,
    name: "Require approval for AI-agent .env reads",
    description: "Requires approval when an AI-agent workflow reads an environment file.",
    enabled: true,
    target: {
      categories: ["AGENT_WORKFLOW"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "AGENT_WORKFLOW",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "agent_workflow.read_env_file",
      },
    ],
    decision: "REQUIRE_APPROVAL",
    remediationEligible: true,
    rationale: "AI-agent reads of .env files may expose local secrets and require review.",
    tags: ["agent-workflow", "env-file", "approval", "phase-0-required"],
  },
  "agent_workflow.read_ssh.block": {
    id: "agent_workflow.read_ssh.block",
    version: POLICY_RULE_VERSION,
    name: "Block AI-agent SSH key reads",
    description: "Blocks AI-agent workflows that access SSH key material.",
    enabled: true,
    target: {
      categories: ["AGENT_WORKFLOW"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "AGENT_WORKFLOW",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "agent_workflow.read_ssh_material",
      },
    ],
    decision: "BLOCK",
    remediationEligible: true,
    rationale: "AI-agent access to SSH material can expose credentials for source control or hosts.",
    tags: ["agent-workflow", "ssh", "block", "phase-0-required"],
  },
  "kubernetes.missing_resource_limits.warn": {
    id: "kubernetes.missing_resource_limits.warn",
    version: POLICY_RULE_VERSION,
    name: "Warn on missing Kubernetes resource limits",
    description: "Warns when Kubernetes workloads do not define resource limits.",
    enabled: true,
    target: {
      categories: ["KUBERNETES"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "KUBERNETES",
      },
      {
        field: "evidence.ruleId",
        operator: "EQUALS",
        value: "kubernetes.missing_resource_limits",
      },
    ],
    decision: "WARN",
    remediationEligible: false,
    rationale: "Missing resource limits can destabilize shared clusters.",
    tags: ["kubernetes", "resource-limits", "warn", "phase-0-required"],
  },
  "dependency.normal_inventory.allow": {
    id: "dependency.normal_inventory.allow",
    version: POLICY_RULE_VERSION,
    name: "Allow normal dependency inventory findings",
    description: "Allows normal dependency inventory items because SBOM generation is not CVE scanning.",
    enabled: true,
    target: {
      categories: ["DEPENDENCY"],
    },
    conditions: [
      {
        field: "category",
        operator: "EQUALS",
        value: "DEPENDENCY",
      },
    ],
    decision: "ALLOW",
    remediationEligible: false,
    rationale: "Dependency entries are treated as inventory unless a separate finding says otherwise.",
    tags: ["dependency", "sbom", "allow", "phase-0-required"],
  },
} satisfies PolicyRuleDictionary;

const fallbackRuleDictionary = {
  "default.high_or_critical.warn": {
    id: "default.high_or_critical.warn",
    version: POLICY_RULE_VERSION,
    name: "Warn on unmatched high risk findings",
    description: "Warns on unmatched high or critical findings when no explicit policy rule exists.",
    enabled: true,
    target: {
      severities: ["HIGH", "CRITICAL"],
    },
    conditions: [
      {
        field: "severity",
        operator: "IN",
        value: ["HIGH", "CRITICAL"],
      },
    ],
    decision: "WARN",
    remediationEligible: false,
    rationale: "Unknown high-severity findings should remain visible even without a specific policy.",
    tags: ["default", "warn"],
  },
  "default.low_or_medium.allow": {
    id: "default.low_or_medium.allow",
    version: POLICY_RULE_VERSION,
    name: "Allow unmatched low and medium findings",
    description: "Allows unmatched low or medium findings when no explicit policy rule exists.",
    enabled: true,
    target: {
      severities: ["LOW", "MEDIUM"],
    },
    conditions: [
      {
        field: "severity",
        operator: "IN",
        value: ["LOW", "MEDIUM"],
      },
    ],
    decision: "ALLOW",
    remediationEligible: false,
    rationale: "Unknown lower-severity findings are recorded without blocking the workflow.",
    tags: ["default", "allow"],
  },
} satisfies PolicyRuleDictionary;

export const POLICY_RULES = policyRuleDictionarySchema.parse(ruleDictionary);
export const FALLBACK_POLICY_RULES = policyRuleDictionarySchema.parse(fallbackRuleDictionary);

function requireRule(rules: PolicyRuleDictionary, ruleId: string): PolicyRule {
  const rule = rules[ruleId];

  if (rule == null) {
    throw new Error(`Policy rule ${ruleId} is not defined`);
  }

  return rule;
}

export const ORDERED_POLICY_RULES: PolicyRule[] = [
  requireRule(POLICY_RULES, "secret.private_key.block"),
  requireRule(POLICY_RULES, "secret.critical.block"),
  requireRule(POLICY_RULES, "kubernetes.privileged_container.block"),
  requireRule(POLICY_RULES, "kubernetes.host_path.require_approval"),
  requireRule(POLICY_RULES, "kubernetes.allow_privilege_escalation.block"),
  requireRule(POLICY_RULES, "dockerfile.latest_tag.warn"),
  requireRule(POLICY_RULES, "dockerfile.missing_user.warn"),
  requireRule(POLICY_RULES, "agent_workflow.remote_script.require_approval"),
  requireRule(POLICY_RULES, "agent_workflow.chmod_777.require_approval"),
  requireRule(POLICY_RULES, "agent_workflow.read_env.require_approval"),
  requireRule(POLICY_RULES, "agent_workflow.read_ssh.block"),
  requireRule(POLICY_RULES, "kubernetes.missing_resource_limits.warn"),
  requireRule(POLICY_RULES, "dependency.normal_inventory.allow"),
];

export const ORDERED_FALLBACK_POLICY_RULES: PolicyRule[] = [
  requireRule(FALLBACK_POLICY_RULES, "default.high_or_critical.warn"),
  requireRule(FALLBACK_POLICY_RULES, "default.low_or_medium.allow"),
];
