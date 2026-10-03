import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DatabaseStatus } from "../../shared/health";
import * as schema from "./schema";

/** The typed Drizzle client for Fennl's D1 database. Create one per request from `env.DB`. */
export function database(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof database>;

/** Asks the database a trivial question, so the health check can say whether it answers. */
export async function databaseStatus(db: Database): Promise<DatabaseStatus> {
  try {
    await db.get(sql`select 1`);
    return "ok";
  } catch {
    return "unavailable";
  }
}
