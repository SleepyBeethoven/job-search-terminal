const CAREER_AGENT_SPREADSHEET_ID = "1MBjx5Oq6lTUnELZydgnyiedHklpH2uM_Xcf_2nrcgvg";
const CAREER_AGENT_INTAKE_SHEET = "Intake";
const CAREER_AGENT_SECRET_PROPERTY = "CAREER_AGENT_BRIDGE_SECRET";
const CAREER_AGENT_MAX_ROWS = 100;

function initializeCareerAgentBridge() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(CAREER_AGENT_SECRET_PROPERTY);
  if (!secret) {
    secret = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].join("");
    props.setProperty(CAREER_AGENT_SECRET_PROPERTY, secret);
  }
  console.log("CAREER_AGENT_BRIDGE_SECRET=" + secret);
  return secret;
}

function doGet() {
  return careerAgentJson_({
    ok: true,
    service: "terry-os-career-agent-queue",
  });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expected = PropertiesService.getScriptProperties().getProperty(CAREER_AGENT_SECRET_PROPERTY);

    if (!expected) {
      return careerAgentJson_({ ok: false, error: "bridge-not-initialized" });
    }
    if (!body.token || body.token !== expected) {
      return careerAgentJson_({ ok: false, error: "unauthorized" });
    }

    if (body.action === "pending") {
      return careerAgentPending_();
    }
    if (body.action === "ack") {
      return careerAgentAck_(body.queueIds || [], body.processedAt || new Date().toISOString());
    }

    return careerAgentJson_({ ok: false, error: "unsupported-action" });
  } catch (error) {
    return careerAgentJson_({ ok: false, error: String(error) });
  }
}

function careerAgentPending_() {
  const sheet = SpreadsheetApp.openById(CAREER_AGENT_SPREADSHEET_ID).getSheetByName(CAREER_AGENT_INTAKE_SHEET);
  if (!sheet) return careerAgentJson_({ ok: false, error: "intake-sheet-missing" });

  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return careerAgentJson_({ ok: true, rows: [] });

  const headers = values[0].map(String);
  const required = ["queue_id", "company", "title", "status"];
  for (const name of required) {
    if (headers.indexOf(name) === -1) {
      return careerAgentJson_({ ok: false, error: "missing-column:" + name });
    }
  }

  const rows = [];
  for (let i = 1; i < values.length && rows.length < CAREER_AGENT_MAX_ROWS; i += 1) {
    const row = {};
    for (let c = 0; c < headers.length; c += 1) row[headers[c]] = values[i][c] || "";
    if (row.status === "Pending Review" && row.queue_id) rows.push(row);
  }

  return careerAgentJson_({ ok: true, rows: rows });
}

function careerAgentAck_(queueIds, processedAt) {
  if (!Array.isArray(queueIds) || queueIds.length === 0) {
    return careerAgentJson_({ ok: true, acknowledged: 0 });
  }

  const wanted = new Set(queueIds.map(String));
  const sheet = SpreadsheetApp.openById(CAREER_AGENT_SPREADSHEET_ID).getSheetByName(CAREER_AGENT_INTAKE_SHEET);
  if (!sheet) return careerAgentJson_({ ok: false, error: "intake-sheet-missing" });

  const range = sheet.getDataRange();
  const values = range.getDisplayValues();
  if (values.length < 2) return careerAgentJson_({ ok: true, acknowledged: 0 });

  const headers = values[0].map(String);
  const queueIdCol = headers.indexOf("queue_id");
  const statusCol = headers.indexOf("status");
  const processedCol = headers.indexOf("processed_at");
  if (queueIdCol < 0 || statusCol < 0 || processedCol < 0) {
    return careerAgentJson_({ ok: false, error: "ack-columns-missing" });
  }

  let acknowledged = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (!wanted.has(String(values[i][queueIdCol] || ""))) continue;
    sheet.getRange(i + 1, statusCol + 1).setValue("Synced to JST");
    sheet.getRange(i + 1, processedCol + 1).setValue(processedAt);
    acknowledged += 1;
  }

  return careerAgentJson_({ ok: true, acknowledged: acknowledged });
}

function careerAgentJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
