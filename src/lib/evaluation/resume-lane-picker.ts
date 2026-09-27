/**
 * Maps role archetype text (from AI or heuristics) to an existing resume lane name.
 * Lane names are user-defined; matching is substring + token overlap, not exact taxonomy.
 *
 * Terry OS uses five stable resume lanes. We recognise those lanes first, then fall back
 * to the upstream generic matcher so the app still works with other user-defined lanes.
 */

type TerryLaneCode = "R1" | "R2" | "R3" | "R4" | "R5";

const TERRY_LANE_HINTS: Record<TerryLaneCode, string[]> = {
  R1: ["ai quality", "evaluation"],
  R2: ["ai operations", "training", "onboarding"],
  R3: ["crm", "customer lifecycle", "engagement operations"],
  R4: ["project", "business operations", "coordinator"],
  R5: ["china market", "bilingual", "mandarin"],
};

const TERRY_ROLE_SIGNALS: Record<TerryLaneCode, Array<[string, number]>> = {
  R1: [
    ["ai evaluator", 6],
    ["ai evaluation", 6],
    ["quality evaluator", 5],
    ["annotation qa", 5],
    ["ai quality", 5],
    ["data annotation", 4],
    ["evaluator", 4],
    ["reviewer", 2],
    ["quality analyst", 3],
  ],
  R2: [
    ["reviewer lead", 7],
    ["quality operations", 6],
    ["ai operations", 6],
    ["calibration", 5],
    ["training and onboarding", 6],
    ["training & onboarding", 6],
    ["trainer", 3],
    ["onboarding", 3],
    ["team lead", 2],
  ],
  R3: [
    ["customer lifecycle", 7],
    ["lifecycle operations", 6],
    ["crm operations", 7],
    ["crm", 5],
    ["salesforce", 4],
    ["customer engagement", 4],
    ["client engagement", 4],
    ["customer operations", 3],
  ],
  R4: [
    ["business operations", 7],
    ["project coordinator", 7],
    ["operations coordinator", 7],
    ["project operations", 6],
    ["implementation coordinator", 5],
    ["process improvement", 4],
    ["project management", 4],
    ["operations", 2],
    ["coordinator", 2],
  ],
  R5: [
    ["china market", 7],
    ["china-facing", 7],
    ["mandarin", 6],
    ["bilingual operations", 7],
    ["chinese market", 6],
    ["wecom", 4],
    ["wechat", 3],
    ["apac", 2],
    ["bilingual", 3],
  ],
};

function findTerryLane(code: TerryLaneCode, resumeNames: string[]): string | undefined {
  const prefix = new RegExp(`^\\s*${code}\\b`, "i");
  const byCode = resumeNames.find((name) => prefix.test(name));
  if (byCode) return byCode;

  const hints = TERRY_LANE_HINTS[code];
  return resumeNames.find((name) => {
    const lower = name.toLowerCase();
    return hints.some((hint) => lower.includes(hint));
  });
}

function pickTerryLane(text: string, resumeNames: string[]): string | undefined {
  const available = (Object.keys(TERRY_ROLE_SIGNALS) as TerryLaneCode[])
    .map((code) => ({ code, name: findTerryLane(code, resumeNames) }))
    .filter((entry): entry is { code: TerryLaneCode; name: string } => Boolean(entry.name));

  // Do not force Terry-specific routing on users who do not actually have the Terry lanes.
  if (available.length < 2) return undefined;

  const lower = text.toLowerCase();
  let best: { name: string; score: number } | undefined;

  for (const lane of available) {
    const score = TERRY_ROLE_SIGNALS[lane.code].reduce(
      (total, [signal, weight]) => total + (lower.includes(signal) ? weight : 0),
      0
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { name: lane.name, score };
    }
  }

  return best?.name;
}

export function pickResumeBase(archetype: string, resumeNames: string[]): string {
  if (resumeNames.length === 0) {
    return "To be selected";
  }

  const terryLane = pickTerryLane(archetype, resumeNames);
  if (terryLane) return terryLane;

  const lower = archetype.toLowerCase();
  const find = (substr: string) => resumeNames.find((n) => n.toLowerCase().includes(substr));
  if (
    lower.includes("leadership") ||
    lower.includes("management") ||
    lower.includes("director") ||
    lower.includes("chief") ||
    lower.includes("vp")
  ) {
    return find("leadership") ?? find("principal") ?? resumeNames[0] ?? "To be selected";
  }
  if (lower.includes("operations")) {
    return find("operations") ?? resumeNames[0] ?? "To be selected";
  }
  if (lower.includes("accessibility") || lower.includes("a11y")) {
    return find("a11y") ?? find("accessibility") ?? resumeNames[0] ?? "To be selected";
  }
  if (lower.includes("education") || lower.includes("teach")) {
    return find("teach") ?? find("education") ?? resumeNames[0] ?? "To be selected";
  }
  return find("principal") ?? find("leadership") ?? resumeNames[0] ?? "To be selected";
}

function bestLaneByTokenOverlap(hints: string[], resumeNames: string[]): string {
  const text = hints.filter(Boolean).join(" ").toLowerCase();
  const tokens = text.split(/[^a-z0-9]+/i).filter((t) => t.length > 3);
  if (tokens.length === 0) {
    return resumeNames[0]!;
  }
  let best = resumeNames[0]!;
  let bestScore = -1;
  for (const name of resumeNames) {
    const nl = name.toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (nl.includes(t) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

/**
 * Always returns a real lane name from `resumeNames` when the list is non-empty,
 * so DB/UI never reference template labels or a mismatched AI string.
 */
export function coerceResumeBaseToLane(
  stored: string,
  roleArchetype: string,
  resumeNames: string[]
): string {
  if (resumeNames.length === 0) {
    return "To be selected";
  }
  if (resumeNames.includes(stored)) {
    return stored;
  }
  const ci = resumeNames.find((n) => n.toLowerCase() === stored.trim().toLowerCase());
  if (ci) {
    return ci;
  }

  // Evaluate both AI strings together so a generic stored label such as "Operations"
  // does not hide a more specific role archetype such as "CRM Operations Manager".
  const terryLane = pickTerryLane([stored, roleArchetype].filter(Boolean).join(" "), resumeNames);
  if (terryLane) return terryLane;

  const fromStored = pickResumeBase(stored, resumeNames);
  if (resumeNames.includes(fromStored)) {
    return fromStored;
  }
  const fromArchetype = pickResumeBase(roleArchetype, resumeNames);
  if (resumeNames.includes(fromArchetype)) {
    return fromArchetype;
  }
  return bestLaneByTokenOverlap([stored, roleArchetype], resumeNames);
}
