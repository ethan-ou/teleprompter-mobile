import { DB_FILE } from "@/db/constants";
import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DB_FILE} onInit={migrateDbIfNeeded}>
      <Stack />
    </SQLiteProvider>
  );
}
