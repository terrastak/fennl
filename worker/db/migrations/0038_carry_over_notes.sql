-- Notes become entries (U7, owner's choices 2026-10-27): each person's signed note
-- (recipe_opinion.note) is carried over to recipe_note entries, signed by them. A note that grew a
-- dated part at a time (U6: "Oct 26, 2026: Used less sugar.", paragraphs apart) becomes one entry
-- per part, dated that day; anything before the first dated part is one entry, dated when the
-- note last changed. recipe_opinion.note is left as it was and no longer shown.
INSERT INTO `recipe_note` (`id`, `recipe_id`, `user_id`, `owner_user_id`, `text`, `written_at`,
  `edited_at`, `field_times`, `updated_at`, `deleted_at`, `server_seq`)
WITH RECURSIVE
  -- One paragraph at a time: `cur` gathers the entry being read; a dated paragraph starts a new
  -- one, and the finished entry is given out as `done`.
  step (recipe_id, user_id, owner_user_id, changed, n, rest, cur, done) AS (
    SELECT o.`recipe_id`, o.`user_id`, o.`owner_user_id`, o.`updated_at`, 0,
      trim(o.`note`) || char(10) || char(10), '', NULL
    FROM `recipe_opinion` o JOIN `recipe` r ON r.`id` = o.`recipe_id`
    WHERE o.`deleted_at` IS NULL AND trim(o.`note`) <> '' AND r.`expunged_at` IS NULL
    UNION ALL
    SELECT recipe_id, user_id, owner_user_id, changed, n + 1,
      substr(rest, instr(rest, char(10) || char(10)) + 2),
      CASE
        WHEN trim(substr(rest, 1, instr(rest, char(10) || char(10)) - 1)) = '' THEN cur
        WHEN cur <> '' AND substr(rest, 1, instr(rest, char(10) || char(10)) - 1)
          GLOB '[A-Z][a-z][a-z] [0-9]*, [0-9][0-9][0-9][0-9]: *'
          THEN substr(rest, 1, instr(rest, char(10) || char(10)) - 1)
        WHEN cur = '' THEN substr(rest, 1, instr(rest, char(10) || char(10)) - 1)
        ELSE cur || char(10) || char(10) || substr(rest, 1, instr(rest, char(10) || char(10)) - 1)
      END,
      CASE
        WHEN cur <> '' AND substr(rest, 1, instr(rest, char(10) || char(10)) - 1)
          GLOB '[A-Z][a-z][a-z] [0-9]*, [0-9][0-9][0-9][0-9]: *'
          THEN cur
      END
    FROM step WHERE rest <> '' AND instr(rest, char(10) || char(10)) > 0
  ),
  entry (recipe_id, user_id, owner_user_id, changed, n, body) AS (
    SELECT recipe_id, user_id, owner_user_id, changed, n, done FROM step WHERE done IS NOT NULL
    UNION ALL
    SELECT recipe_id, user_id, owner_user_id, changed, n + 1, cur FROM step
    WHERE rest = '' AND cur <> ''
  ),
  -- A dated entry: its day (at noon, plus its place so same-day parts keep their order) and its
  -- words without the date.
  parsed (recipe_id, user_id, owner_user_id, changed, n, text, day) AS (
    SELECT recipe_id, user_id, owner_user_id, changed, n,
      CASE WHEN body GLOB '[A-Z][a-z][a-z] [0-9]*, [0-9][0-9][0-9][0-9]: *'
        THEN trim(substr(body, instr(body, ': ') + 2)) ELSE trim(body) END,
      CASE WHEN body GLOB '[A-Z][a-z][a-z] [0-9]*, [0-9][0-9][0-9][0-9]: *'
        THEN CAST(strftime('%s', printf('%04d-%02d-%02d 12:00:00',
          CAST(substr(body, instr(body, ', ') + 2, 4) AS INTEGER),
          (instr('JanFebMarAprMayJunJulAugSepOctNovDec', substr(body, 1, 3)) + 2) / 3,
          CAST(substr(body, 5, instr(body, ',') - 5) AS INTEGER))) AS INTEGER) * 1000 + n
      END
    FROM entry
  ),
  -- Words from before the first dated part come just before it (or when the note last changed).
  dated (recipe_id, user_id, owner_user_id, n, text, written) AS (
    SELECT recipe_id, user_id, owner_user_id, n, text,
      coalesce(day, min(changed, coalesce(
        min(day) OVER (PARTITION BY recipe_id, user_id) - 1, changed)))
    FROM parsed
  )
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
    || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2) || '-'
    || lower(hex(randomblob(6))),
  recipe_id, user_id, owner_user_id, text, written, NULL,
  json_object('text', written), written, NULL,
  (SELECT `value` FROM `sync_counter` WHERE `id` = 1)
    + row_number() OVER (ORDER BY recipe_id, user_id, n)
FROM dated WHERE text <> '';
--> statement-breakpoint
-- The new entries took the next numbers: move the counter past them, so devices fetch them.
UPDATE `sync_counter` SET `value` = (
  SELECT max(`value`, coalesce((SELECT max(`server_seq`) FROM `recipe_note`), 0))
  FROM `sync_counter` WHERE `id` = 1
) WHERE `id` = 1;
