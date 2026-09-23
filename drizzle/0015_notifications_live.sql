-- Live notifications: every change to a user's notifications is announced on
-- the "bela_notifications" channel with the user id as payload, whichever code
-- path wrote it. The app LISTENs once per process and pushes to that user's
-- open tabs over server-sent events. Statement-level with transition tables,
-- so "mark all read" is one announcement per user, not one per row.
CREATE OR REPLACE FUNCTION notifications_announce() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bela_notifications', u.user_id)
     FROM (SELECT DISTINCT user_id FROM changed_rows) u;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS notifications_announce_insert ON "notification";
--> statement-breakpoint
CREATE TRIGGER notifications_announce_insert
  AFTER INSERT ON "notification"
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notifications_announce();
--> statement-breakpoint
DROP TRIGGER IF EXISTS notifications_announce_update ON "notification";
--> statement-breakpoint
CREATE TRIGGER notifications_announce_update
  AFTER UPDATE ON "notification"
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION notifications_announce();
