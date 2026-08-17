import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const registryPath = resolve(process.argv[2] ?? "docs/release-readiness.json");
const blockingSeverities = new Set(["critical", "high"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCloseEvidence(value) {
  return (
    isRecord(value) &&
    typeof value.verifiedAt === "string" &&
    value.verifiedAt.length > 0 &&
    typeof value.verifiedBy === "string" &&
    value.verifiedBy.length > 0 &&
    typeof value.evidence === "string" &&
    value.evidence.length > 0
  );
}

function parseRegistry(value) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.blockers)) {
    throw new Error("release registry must contain version 1 and a blockers array");
  }
  for (const blocker of value.blockers) {
    if (
      !isRecord(blocker) ||
      typeof blocker.id !== "string" ||
      typeof blocker.title !== "string" ||
      !["low", "medium", "high", "critical"].includes(blocker.severity) ||
      !["open", "closed"].includes(blocker.status)
    ) {
      throw new Error("release registry contains an invalid blocker");
    }
  }
  return value.blockers;
}

try {
  const blockers = parseRegistry(JSON.parse(await readFile(registryPath, "utf8")));
  const failures = blockers.flatMap((blocker) => {
    if (!blockingSeverities.has(blocker.severity)) return [];
    if (blocker.status === "open") return [`${blocker.id}: ${blocker.title} (${blocker.severity}, open)`];
    if (!hasCloseEvidence(blocker.closeEvidence)) return [`${blocker.id}: close evidence is required`];
    return [];
  });
  if (failures.length > 0) {
    console.error(`release gate blocked:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`release gate passed: ${registryPath}`);
  }
} catch (error) {
  console.error(`release gate invalid: ${error instanceof Error ? error.message : "UnknownError"}`);
  process.exitCode = 2;
}
