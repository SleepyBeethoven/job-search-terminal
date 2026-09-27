import { describe, expect, it } from "vitest";
import { scanSecurityEntries, securityVerdict } from "@/lib/security/security-agent";

describe("Security Agent v0.1", () => {
  it("passes normal public source files", () => {
    const findings = scanSecurityEntries([
      { path: "src/example.ts", content: 'const label = "Career Agent";' },
      { path: "data/.gitkeep", content: "" },
    ]);
    expect(findings).toEqual([]);
    expect(securityVerdict(findings)).toBe("PASS");
  });

  it("blocks runtime user data from public Git", () => {
    const findings = scanSecurityEntries([
      { path: "data/job-search-terminal.sqlite" },
      { path: "assets/Terry_Resume.pdf" },
      { path: "output/tailored-resume.pdf" },
    ]);
    expect(findings.map((finding) => finding.rule)).toEqual([
      "tracked-runtime-user-data",
      "tracked-runtime-user-data",
      "tracked-runtime-user-data",
    ]);
    expect(securityVerdict(findings)).toBe("BLOCK");
  });

  it("blocks tracked runtime environment files", () => {
    const findings = scanSecurityEntries([
      { path: ".env.local", content: "TOKEN=secret" },
    ]);
    expect(findings.some((finding) => finding.rule === "tracked-env-file")).toBe(true);
  });

  it("blocks personal mailbox addresses in public tracked content", () => {
    const findings = scanSecurityEntries([
      { path: "docs/private-note.md", content: "Contact me at " + "person123" + "@" + "gmail.com" },
    ]);
    expect(findings.some((finding) => finding.rule === "personal-email")).toBe(true);
  });

  it("blocks a literal private Google Sheet identifier", () => {
    const findings = scanSecurityEntries([
      {
        path: "config/private.json",
        content: '{"spreadsheetId":"' + "1AbCdEfGhIjKlMnOpQrStUvWxYz" + "0123456789" + '"}',
      },
    ]);
    expect(findings.some((finding) => finding.rule === "private-google-sheet-id")).toBe(true);
  });

  it("allows a runtime description that does not expose the Sheet id", () => {
    const findings = scanSecurityEntries([
      {
        path: "config/career-agent-email-intake.json",
        content: '{"spreadsheetIdSource":"private-runtime-state"}',
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("blocks common hard-coded secret forms", () => {
    const findings = scanSecurityEntries([
      {
        path: "src/bad.ts",
        content: 'const token = "' + "ghp_" + "1234567890abcdefghijklmnop" + '";',
      },
    ]);
    expect(findings.some((finding) => finding.rule === "credential-github")).toBe(true);
  });
});
