-- Rules that column checks cannot express. Both raise check_violation (SQLSTATE 23514).

-- A namespace path is its parent's path plus one segment, and a root path has one segment.
-- Paths and parents never change: moving a namespace would need every descendant path rewritten.
CREATE FUNCTION namespaces_check_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	expected_parent_path text := regexp_replace(NEW.path, '/[^/]+$', '');
	actual_parent_path text;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'namespace "%" cannot be moved or renamed', OLD.path
			USING ERRCODE = 'check_violation';
	END IF;
	IF NEW.parent_id IS NULL THEN
		IF expected_parent_path <> NEW.path THEN
			RAISE EXCEPTION 'namespace "%" needs parent "%"', NEW.path, expected_parent_path
				USING ERRCODE = 'check_violation';
		END IF;
	ELSE
		SELECT path INTO actual_parent_path FROM namespaces WHERE id = NEW.parent_id;
		-- A missing parent is left to the foreign key to report.
		IF FOUND AND actual_parent_path <> expected_parent_path THEN
			RAISE EXCEPTION 'namespace "%" is not a child of its parent "%"', NEW.path, actual_parent_path
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER namespaces_check_path
	BEFORE INSERT OR UPDATE OF path, parent_id ON namespaces
	FOR EACH ROW EXECUTE FUNCTION namespaces_check_path();
--> statement-breakpoint

-- Published definition versions are immutable (ADR 0002). Allowed status moves are
-- draft -> published and published -> retired; retiring changes nothing but status and
-- updated_at. Published and retired rows cannot be deleted.
CREATE FUNCTION definition_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status <> 'draft' THEN
			RAISE EXCEPTION 'definition version % is % and cannot be deleted', OLD.id, OLD.status
				USING ERRCODE = 'check_violation';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD.status = 'draft' THEN
		IF NEW.status = 'retired' THEN
			RAISE EXCEPTION 'definition version % is a draft and cannot be retired', OLD.id
				USING ERRCODE = 'check_violation';
		END IF;
		RETURN NEW;
	END IF;

	IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
		OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'retired'))
	THEN
		RAISE EXCEPTION 'definition version % is % and immutable', OLD.id, OLD.status
			USING ERRCODE = 'check_violation',
				HINT = 'Create a new version instead; a published version can only be retired.';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER definition_versions_guard
	BEFORE UPDATE OR DELETE ON definition_versions
	FOR EACH ROW EXECUTE FUNCTION definition_versions_guard();
