DO $$
DECLARE
  rec RECORD;
  candidate TEXT;
  counter INTEGER;
  prefix TEXT;
  suffix TEXT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS tmp_reserved_user_names (
    name_key TEXT PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO tmp_reserved_user_names (name_key)
  SELECT LOWER("name")
  FROM (
    SELECT
      "id",
      "name",
      ROW_NUMBER() OVER (PARTITION BY LOWER("name") ORDER BY "createdAt", "id") AS duplicate_rank
    FROM "User"
  ) ranked_users
  WHERE duplicate_rank = 1
  ON CONFLICT DO NOTHING;

  FOR rec IN
    SELECT "id", "name"
    FROM (
      SELECT
        "id",
        "name",
        ROW_NUMBER() OVER (PARTITION BY LOWER("name") ORDER BY "createdAt", "id") AS duplicate_rank
      FROM "User"
    ) ranked_users
    WHERE duplicate_rank > 1
    ORDER BY LOWER("name"), duplicate_rank, "id"
  LOOP
    counter := 1;

    LOOP
      suffix := '#' || counter::TEXT;
      prefix := LEFT(REGEXP_REPLACE(rec."name", '\s+', '', 'g'), GREATEST(1, 16 - LENGTH(suffix)));
      IF prefix = '' THEN
        prefix := LEFT('Player', GREATEST(1, 16 - LENGTH(suffix)));
      END IF;
      candidate := prefix || suffix;

      IF NOT EXISTS (
        SELECT 1
        FROM tmp_reserved_user_names
        WHERE name_key = LOWER(candidate)
      ) THEN
        UPDATE "User"
        SET "name" = candidate
        WHERE "id" = rec."id";

        INSERT INTO tmp_reserved_user_names (name_key)
        VALUES (LOWER(candidate));
        EXIT;
      END IF;

      counter := counter + 1;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "User_name_key" ON "User"("name");
CREATE UNIQUE INDEX "User_name_lower_key" ON "User"(LOWER("name"));
