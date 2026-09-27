import { closeDatabase } from "../src/lib/db/client";
import { syncGoogleSheetIntake } from "../src/lib/scanner/google-sheet-intake";

try {
  const result = await syncGoogleSheetIntake();
  console.log(JSON.stringify(result, null, 2));
} finally {
  closeDatabase();
}
