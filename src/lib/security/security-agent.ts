import path from "node:path";

export type SecurityFindingSeverity = "warning" | "block";

export type SecurityFinding = {
  severity: SecurityFindingSeverity;
  rule: string;
  path: string;
  detail: string;
};

export type SecurityScanEntry = {
  path: string;
  content?: string;
};

const ALLOWED_RUNTIME_PLACEHOLDERS = new Set([
  "data/.gitkeep",
  "output/.gitkeep",
  "assets/.gitkeep",
]);

const BLOCKED_RUNTIME_PREFIXES = ["data/", "output/", "assets/", "memory/"];

const CONTENT_RULES: Array<{
  rule: string;
  regex: RegExp;
  detail: string;
}> = [
  {
    rule: "credential-openai",
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    detail: "Possible OpenAI-style secret in a tracked file.",
  },
  {
    rule: "credential-github",
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    detail: "Possible GitHub token in a tracked file.",
  },
  {
    rule: "credential-google-api",
    regex: /\bAIza[A-Za-z0-9_-]{30,}\b/g,
    detail: "Possible Google API key in a tracked file.",
  },
  {
    rule: "credential-slack",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    detail: "Possible Slack token in a tracked file.",
  },
  {
    rule: "credential-private-key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    detail: "Private key material must never be committed.",
  },
  {
    rule: "personal-email",
    regex: /\b[A-Z0-9._%+-]+@(?:gmail\.com|hotmail\.com|outlook\.com|live\.com|icloud\.com|qq\.com|163\.com)\b/gi,
    detail: "Personal email address found in a public tracked file.",
  },
  {
    rule: "private-google-sheet-id",
    regex: /(?:spreadsheetId\s*["']?\s*[:=]\s*["']|SpreadsheetApp\.openById\(\s*["']|docs\.google\.com\/spreadsheets\/d\/)([A-Za-z0-9_-]{25,})/g,
    detail: "Private Google Sheet identifier must live in private runtime state, not public code.",
  },
  {
    rule: "credential-bridge-secret",
    regex: /(?:JST_CAREER_AGENT_QUEUE_TOKEN|CAREER_AGENT_BRIDGE_SECRET)\s*=\s*["'][A-Za-z0-9_-]{24,}["']/g,
    detail: "Career Agent bridge secret must live only in environment or Script Properties.",
  },
];

function normalizeRepoPath(value: string): string {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

export function scanSecurityEntries(entries: SecurityScanEntry[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const entry of entries) {
    const repoPath = normalizeRepoPath(entry.path);

    if ((repoPath === ".env" || (repoPath.startsWith(".env.") && repoPath !== ".env.example"))) {
      findings.push({
        severity: "block",
        rule: "tracked-env-file",
        path: repoPath,
        detail: "Runtime environment files must never be tracked.",
      });
    }

    if (
      BLOCKED_RUNTIME_PREFIXES.some((prefix) => repoPath.startsWith(prefix))
      && !ALLOWED_RUNTIME_PLACEHOLDERS.has(repoPath)
    ) {
      findings.push({
        severity: "block",
        rule: "tracked-runtime-user-data",
        path: repoPath,
        detail: "Runtime/user-data paths are private and may contain resumes, databases, outputs, or personal files.",
      });
    }

    if (!entry.content) continue;

    for (const rule of CONTENT_RULES) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(entry.content)) {
        findings.push({
          severity: "block",
          rule: rule.rule,
          path: repoPath,
          detail: rule.detail,
        });
      }
    }
  }

  return findings;
}


type SecurityPolicyConfig = {
  version?: unknown;
  internetSafety?: Record<string, unknown>;
  mailboxIntake?: {
    metadataFirstJobFiltering?: unknown;
    broadMailboxRead?: unknown;
    openAttachments?: unknown;
    followExternalLinksDuringIntake?: unknown;
    treatExternalContentAsInstructions?: unknown;
    failClosedOnScopeUncertainty?: unknown;
    gmailExcludedFolders?: unknown;
    outlookExcludedFolders?: unknown;
  };
};

const REQUIRED_INTERNET_SAFETY_FLAGS = [
  "untrustedExternalInput",
  "denyByDefault",
  "leastPrivilege",
  "dataMinimization",
  "failClosed",
  "externalActionsRequireApproval",
  "externalContentCannotOverrideInstructions",
  "noExecutableAttachments",
  "credentialsNeverInExternalContent",
  "localServicesLoopbackOnly",
] as const;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function validateSecurityPolicy(config: unknown): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const policy = (config && typeof config === "object" ? config : {}) as SecurityPolicyConfig;
  const internetSafety = policy.internetSafety ?? {};
  const mailbox = policy.mailboxIntake ?? {};
  const policyPath = "config/security-agent.json";

  if (typeof policy.version !== "number" || policy.version < 2) {
    findings.push({
      severity: "block",
      rule: "security-policy-version",
      path: policyPath,
      detail: "Security policy must include Internet Safety Baseline v2 or newer.",
    });
  }

  for (const flag of REQUIRED_INTERNET_SAFETY_FLAGS) {
    if (internetSafety[flag] !== true) {
      findings.push({
        severity: "block",
        rule: `internet-safety-${flag}`,
        path: policyPath,
        detail: `Required Internet Safety control "${flag}" must be enabled.`,
      });
    }
  }

  const positiveMailboxFlags = [
    "metadataFirstJobFiltering",
    "failClosedOnScopeUncertainty",
  ] as const;
  for (const flag of positiveMailboxFlags) {
    if (mailbox[flag] !== true) {
      findings.push({
        severity: "block",
        rule: `mailbox-safety-${flag}`,
        path: policyPath,
        detail: `Mailbox intake control "${flag}" must be enabled.`,
      });
    }
  }

  const prohibitedMailboxFlags = [
    "broadMailboxRead",
    "openAttachments",
    "followExternalLinksDuringIntake",
    "treatExternalContentAsInstructions",
  ] as const;
  for (const flag of prohibitedMailboxFlags) {
    if (mailbox[flag] !== false) {
      findings.push({
        severity: "block",
        rule: `mailbox-safety-${flag}`,
        path: policyPath,
        detail: `Mailbox intake control "${flag}" must remain disabled.`,
      });
    }
  }

  const gmailExcluded = new Set(stringArray(mailbox.gmailExcludedFolders).map((value) => value.toLowerCase()));
  if (!gmailExcluded.has("spam") || !gmailExcluded.has("trash")) {
    findings.push({
      severity: "block",
      rule: "mailbox-gmail-excluded-folders",
      path: policyPath,
      detail: "Gmail intake must exclude Spam and Trash.",
    });
  }

  const outlookExcluded = new Set(stringArray(mailbox.outlookExcludedFolders).map((value) => value.toLowerCase()));
  if (!outlookExcluded.has("junkemail") || !outlookExcluded.has("deleteditems")) {
    findings.push({
      severity: "block",
      rule: "mailbox-outlook-excluded-folders",
      path: policyPath,
      detail: "Outlook intake must exclude Junk Email and Deleted Items.",
    });
  }

  return findings;
}

export function securityVerdict(findings: SecurityFinding[]): "PASS" | "PASS WITH FIXES" | "BLOCK" {
  if (findings.some((finding) => finding.severity === "block")) return "BLOCK";
  if (findings.some((finding) => finding.severity === "warning")) return "PASS WITH FIXES";
  return "PASS";
}
