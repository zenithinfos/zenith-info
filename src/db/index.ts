import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Accès base de données.
 *
 * DATABASE_URL absent (ou injoignable au démarrage) => `db` vaut null et les
 * routes basculent sur un stockage mémoire. Le jeu reste jouable en démo, les
 * données ne survivent simplement pas au redémarrage.
 */

export type Database = PostgresJsDatabase<typeof schema>;

const url = process.env.DATABASE_URL?.trim();

let client: postgres.Sql | null = null;
let database: Database | null = null;
let initError: string | null = null;

if (url) {
  try {
    client = postgres(url, {
      max: Number(process.env.DATABASE_POOL ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    database = drizzle(client, { schema });
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error);
    console.error("[db] initialisation impossible :", initError);
  }
} else {
  initError = "DATABASE_URL non défini";
}

export const db = database;

export function hasDatabase(): boolean {
  return database !== null;
}

export function databaseStatus(): {
  configured: boolean;
  reachable: boolean | null;
  error: string | null;
  mode: "postgres" | "memoire";
} {
  return {
    configured: Boolean(url),
    reachable: database ? true : url ? false : null,
    error: initError,
    mode: database ? "postgres" : "memoire",
  };
}

/** Vérifie réellement la connexion (appelé par /api/health). */
export async function pingDatabase(): Promise<boolean> {
  if (!client) return false;
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    database = null;
  }
}

export { schema };
