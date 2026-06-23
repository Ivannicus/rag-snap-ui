import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { readFileSync } from "fs";

const serviceAccount = JSON.parse(readFileSync("./service-account.json", "utf-8"));
initializeApp({
  credential: cert(serviceAccount),
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
});
const db = getDatabase();

async function main() {
  console.time("fetch");
  const snapshot = await db.ref("rfpDatabase").once("value");
  console.timeEnd("fetch");
  
  const val = snapshot.val();
  if (!val) {
    console.log("No data found at /rfpDatabase");
    return;
  }
  
  const keys = Object.keys(val);
  console.log(`Record count: ${keys.length}`);
  
  const jsonStr = JSON.stringify(val);
  console.log(`Data size: ${(jsonStr.length / 1024 / 1024).toFixed(2)} MB`);
  
  // Check a sample record
  const sampleKey = keys[0];
  const sample = val[sampleKey];
  console.log(`Sample record keys: ${Object.keys(sample).join(", ")}`);
  console.log(`Sample question length: ${sample.question?.length ?? "N/A"}`);
  console.log(`Sample answer length: ${sample.answer?.length ?? "N/A"}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
