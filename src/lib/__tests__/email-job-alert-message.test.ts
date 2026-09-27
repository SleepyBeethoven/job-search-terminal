import { describe, expect, it } from "vitest";
import {
  canonicalizeJobPostingUrl,
  parseEmailJobAlertMessage,
} from "@/lib/scanner/email-job-alert-importer";

describe("connector email job-alert intake", () => {
  it("parses company-first Gmail digest layouts", () => {
    const parsed = parseEmailJobAlertMessage({
      provider: "gmail",
      messageId: "gmail-company-first",
      subject: "Your job listings",
      from: "alerts@example.com",
      date: "2026-09-27T00:00:00Z",
      text: [
        "Example Consulting",
        "Project Management Consultant",
        "Melbourne VIC",
        "https://careers.example.com/jobs/12345",
      ].join("\n"),
    });

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject({
      company: "Example Consulting",
      position: "Project Management Consultant",
      location: "Melbourne VIC",
      postingResolutionStatus: "resolved",
    });
  });

  it("recognises Terry OS role families that the upstream UX-focused matcher missed", () => {
    const parsed = parseEmailJobAlertMessage({
      provider: "outlook",
      messageId: "outlook-1",
      subject: "Your job alert",
      from: "alerts@example.com",
      date: "2026-09-27T00:00:00Z",
      text: [
        "AI Quality Reviewer at Example AI, Sydney (Hybrid)",
        "https://www.linkedin.com/jobs/view/1234567890?trackingId=outlook-abc",
        "CRM Operations Specialist at Example CRM, Melbourne",
        "https://www.linkedin.com/jobs/view/2234567890?trackingId=outlook-def",
      ].join("\n"),
    });

    expect(parsed.candidates.map((candidate) => candidate.position)).toContain("AI Quality Reviewer");
    expect(parsed.candidates.map((candidate) => candidate.position)).toContain("CRM Operations Specialist");
  });

  it("canonicalises LinkedIn tracking URLs", () => {
    expect(
      canonicalizeJobPostingUrl(
        "https://au.linkedin.com/comm/jobs/view/1234567890/?trackingId=abc&refId=xyz"
      )
    ).toBe("https://www.linkedin.com/jobs/view/1234567890");
  });


  it("unwraps Outlook SafeLinks around LinkedIn postings", () => {
    const target = "https://www.linkedin.com/comm/jobs/view/3141592653/?trackingId=mail-track&refId=mail-ref";
    const safeLink = `https://example.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=opaque`;

    expect(canonicalizeJobPostingUrl(safeLink)).toBe(
      "https://www.linkedin.com/jobs/view/3141592653"
    );

    const parsed = parseEmailJobAlertMessage({
      provider: "outlook",
      messageId: "outlook-safe-link",
      subject: "LinkedIn job alert",
      from: "jobalerts-noreply@linkedin.com",
      date: "2026-09-27T00:00:00Z",
      text: [
        "AI Quality Analyst at Example Labs, Sydney",
        safeLink,
      ].join("\n"),
    });

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].url).toBe("https://www.linkedin.com/jobs/view/3141592653");
  });

  it("dedupes the same posting across Gmail and Outlook tracking links", () => {
    const outlook = parseEmailJobAlertMessage({
      provider: "outlook",
      messageId: "outlook-2",
      subject: "LinkedIn job alert",
      from: "jobalerts-noreply@linkedin.com",
      date: "2026-09-27T00:00:00Z",
      text: [
        "AI Operations Specialist at Example Co, Sydney",
        "https://www.linkedin.com/jobs/view/9876543210?trackingId=outlook-track&refId=one",
      ].join("\n"),
    });

    const gmail = parseEmailJobAlertMessage({
      provider: "gmail",
      messageId: "gmail-2",
      subject: "LinkedIn job alert",
      from: "jobalerts-noreply@linkedin.com",
      date: "2026-09-27T00:01:00Z",
      text: [
        "AI Operations Specialist at Example Co, Sydney",
        "https://www.linkedin.com/jobs/view/9876543210?trackingId=gmail-track&refId=two",
      ].join("\n"),
    });

    expect(outlook.candidates).toHaveLength(1);
    expect(gmail.candidates).toHaveLength(1);
    expect(outlook.candidates[0].id).toBe(gmail.candidates[0].id);
    expect(outlook.candidates[0].url).toBe("https://www.linkedin.com/jobs/view/9876543210");
    expect(gmail.candidates[0].url).toBe("https://www.linkedin.com/jobs/view/9876543210");
  });
});
