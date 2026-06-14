import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defaultAppConfig, matches, teams } from "../src/data/worldCup2026";

function readEnvFile() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const rows = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = rest.join("=");
  }
}

readEnvFile();

const projectId = process.env.VITE_FIREBASE_PROJECT_ID ?? "wolrd-cup-bet";
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!getApps().length) {
  if (serviceAccountPath) {
    initializeApp({
      credential: cert(JSON.parse(readFileSync(serviceAccountPath, "utf8"))),
      projectId
    });
  } else {
    initializeApp({ projectId });
  }
}

const db = getFirestore();
const batch = db.batch();

batch.set(db.doc("app/config"), defaultAppConfig, { merge: true });

for (const team of teams) {
  batch.set(db.doc(`teams/${team.id}`), team, { merge: true });
}

for (const match of matches) {
  const normalizedMatch =
    match.status === "completed" && match.predictionsLocked === undefined
      ? { ...match, predictionsLocked: true }
      : match;
  const patch =
    normalizedMatch.status === "completed" && normalizedMatch.winnerTeamId === undefined
      ? { ...normalizedMatch, winnerTeamId: FieldValue.delete() }
      : normalizedMatch;
  batch.set(db.doc(`matches/${match.id}`), patch, { merge: true });
}

await batch.commit();

console.log(`Seed completado: ${teams.length} equipos y ${matches.length} partidos en ${projectId}.`);
