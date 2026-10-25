-- Rules that column checks cannot express. All raise check_violation (SQLSTATE 23514).

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

-- Definition versions are immutable (ADR 0002). They are created at publish time, and the
-- only allowed change is retiring a published version, which changes nothing but status and
-- updated_at. Versions cannot be deleted.
CREATE FUNCTION definition_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'definition version % is % and cannot be deleted', OLD.id, OLD.status
			USING ERRCODE = 'check_violation';
	END IF;

	IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at')
		OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'retired'))
	THEN
		RAISE EXCEPTION 'definition version % is % and immutable', OLD.id, OLD.status
			USING ERRCODE = 'check_violation',
				HINT = 'Publish a new version instead; a published version can only be retired.';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER definition_versions_guard
	BEFORE UPDATE OR DELETE ON definition_versions
	FOR EACH ROW EXECUTE FUNCTION definition_versions_guard();
--> statement-breakpoint

-- A case pins a published version; a retired version takes no new cases (ADR 0002).
-- FOR SHARE makes a concurrent retire wait, so it cannot slip in between check and insert.
CREATE FUNCTION cases_check_definition_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	pinned_status definition_version_status;
BEGIN
	SELECT status INTO pinned_status FROM definition_versions
		WHERE id = NEW.definition_version_id FOR SHARE;
	-- A missing version is left to the foreign key to report.
	IF FOUND AND pinned_status <> 'published' THEN
		RAISE EXCEPTION 'definition version % is % and cannot take new cases',
			NEW.definition_version_id, pinned_status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cases_check_definition_version
	BEFORE INSERT OR UPDATE OF definition_version_id ON cases
	FOR EACH ROW EXECUTE FUNCTION cases_check_definition_version();
