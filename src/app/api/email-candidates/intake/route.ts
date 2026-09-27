import { NextResponse } from "next/server";
import {
  importEmailJobAlertMessage,
  type NormalizedEmailJobAlertMessage,
} from "@/lib/scanner/email-job-alert-importer";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 1_000_000;

type IntakeBody = Partial<NormalizedEmailJobAlertMessage>;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as IntakeBody;
    const provider = body.provider;
    const messageId = String(body.messageId ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const from = String(body.from ?? "").trim();
    const date = String(body.date ?? "").trim();
    const text = String(body.text ?? "");
    const html = String(body.html ?? "");

    if (!provider || !["gmail", "outlook", "other"].includes(provider)) {
      return NextResponse.json({ error: "provider must be gmail, outlook, or other" }, { status: 400 });
    }
    if (!messageId || !subject) {
      return NextResponse.json({ error: "messageId and subject are required" }, { status: 400 });
    }
    if (text.length + html.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "email body is too large" }, { status: 413 });
    }

    const result = importEmailJobAlertMessage({
      provider,
      messageId,
      subject,
      from,
      date,
      text,
      html,
    });

    return NextResponse.json({
      success: true,
      ...result,
      reviewPath: "/jobs",
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
