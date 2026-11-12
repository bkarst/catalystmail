-- Live updates (spec §4.2, §13.4 streamEvents): every new activity is announced on the
-- `catalyst_activity` channel as "<workspace_id>:<activity_id>", for the SSE stream to read.
CREATE OR REPLACE FUNCTION catalyst_notify_activity() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('catalyst_activity', NEW.workspace_id || ':' || NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER activities_notify AFTER INSERT ON activities FOR EACH ROW EXECUTE FUNCTION catalyst_notify_activity();
