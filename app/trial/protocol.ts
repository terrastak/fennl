/** Messages between the storage trial page and its database worker (phase C2). */

export type TrialRequest =
  { type: "open" } | { type: "write"; count: number } | { type: "measure" } | { type: "clear" };

export interface SearchResult {
  query: string;
  ms: number;
  matches: number;
  shown: number;
}

export type TrialResponse =
  | { type: "opened"; sqliteVersion: string; loadMs: number; openMs: number; existing: number }
  | { type: "progress"; written: number; of: number }
  | { type: "written"; count: number; ms: number; textBytes: number }
  | {
      type: "measured";
      total: number;
      searches: SearchResult[];
      listMs: number;
      readOneMs: number;
    }
  | { type: "cleared" }
  | { type: "error"; during: TrialRequest["type"]; busy: boolean; message: string };
