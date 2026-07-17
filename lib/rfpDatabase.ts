import { ref, onValue, off } from "firebase/database";
import { db } from "./firebase";
import type { RfpRecord } from "./types";

export function subscribeToRfpDatabase(
  onUpdate: (records: RfpRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const dbRef = ref(db, "rfpDatabase");
  const unsubscribe = onValue(
    dbRef,
    (snapshot) => {
      const val = snapshot.val();
      if (!val) {
        onUpdate([]);
        return;
      }
      const records: RfpRecord[] = Object.entries(
        val as Record<string, Omit<RfpRecord, "id">>
      ).map(([id, record]) => ({ id, ...record }));
      onUpdate(records);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
  return () => off(dbRef);
}

export function searchRfpRecords(
  records: RfpRecord[],
  query: string,
  dateFilter?: string
): RfpRecord[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return records.filter((r) => {
    if (dateFilter && r.rfpDate !== dateFilter) return false;
    if (terms.length === 0) return true;
    const haystack = `${r.question} ${r.answer}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
