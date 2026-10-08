import { INDEX_ALL_SQL, SEARCH_SCHEMA } from "./search";

// The tables of the browser's copy (phase C4), shared by the database worker and the tests.

/**
 * The local tables, one step per schema version (PRAGMA user_version). A device may have any
 * older version, so steps are only ever added, never changed.
 */
export const MIGRATIONS = [
  `create table meta (key text primary key, value text not null);
   create table cursor (owner_user_id text primary key, seq integer not null);
   create table member (user_id text primary key, name text not null, position integer not null);
   create table record (
     kind text not null,
     key text not null,
     owner_user_id text not null,
     server_data text,
     data text,
     primary key (kind, key)
   );
   create index record_owner on record (owner_user_id);
   create table outbox (
     seq integer primary key autoincrement,
     kind text not null,
     key text not null,
     change text not null,
     created_at integer not null
   );
   create index outbox_record on outbox (kind, key);
   create table recheck (kind text not null, key text not null, primary key (kind, key));`,
  // Search (phase C8): the index, filled from what's already here.
  `${SEARCH_SCHEMA} ${INDEX_ALL_SQL}`,
];
