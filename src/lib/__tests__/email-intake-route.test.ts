import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/email-candidates/intake/route";

describe("connector email intake API boundary", () => {
  it("ignores Gmail mail before the hard cutoff before import", async () => {
    const request = new Request("http://localhost/api/email-candidates/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "gmail",
        messageId: "historical-gmail",
        subject: "Old job alert",
        from: "alerts@example.com",
        date: "2026-09-26T23:00:00Z",
        receivedAt: "2026-09-27T03:06:59Z",
        lastSuccessfulScanAt: "2026-09-27T03:07:00Z",
        text: "AI Operations Specialist at Historical Co, Sydney",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ignored: true,
      reason: "before-hard-cutoff",
    });
  });

  it("fails closed when the current provider watermark is not supplied", async () => {
    const request = new Request("http://localhost/api/email-candidates/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "gmail",
        messageId: "no-watermark",
        subject: "New job alert",
        from: "alerts@example.com",
        date: "2026-09-27T09:30:01Z",
        receivedAt: "2026-09-27T09:30:01Z",
        text: "AI Quality Reviewer at Example Labs, Sydney",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ignored: true,
      reason: "missing-watermark",
    });
  });

  it("fails closed when a connected mailbox message has no usable receive timestamp", async () => {
    const request = new Request("http://localhost/api/email-candidates/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "outlook",
        messageId: "missing-time",
        subject: "Job alert",
        from: "alerts@example.com",
        date: "",
        lastSuccessfulScanAt: "2026-09-27T03:07:00Z",
        text: "CRM Operations Specialist at Example Co, Melbourne",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ignored: true,
      reason: "invalid-received-at",
    });
  });
});
