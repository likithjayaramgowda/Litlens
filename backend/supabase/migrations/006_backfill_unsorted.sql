-- Migration 006: Backfill "Unsorted" project for existing data
-- Run AFTER migration 005_projects.sql.
--
-- For every user who has papers or conversations with project_id = NULL,
-- this script creates a single "Unsorted" project and assigns all their
-- NULL-project rows to it.  Idempotent: re-running it is safe because the
-- DO block only touches rows that still have project_id = NULL.

DO $$
DECLARE
    r           RECORD;
    proj_id     UUID;
BEGIN
    -- ── Collect all user_ids that have unassigned papers ──────────────────────
    FOR r IN
        SELECT DISTINCT user_id
          FROM public.papers
         WHERE project_id IS NULL
    LOOP
        -- Check whether this user already has an "Unsorted" project
        SELECT id INTO proj_id
          FROM public.projects
         WHERE user_id = r.user_id
           AND name    = 'Unsorted'
         LIMIT 1;

        -- Create the project if it doesn't exist yet
        IF proj_id IS NULL THEN
            INSERT INTO public.projects (user_id, name, description)
            VALUES (
                r.user_id,
                'Unsorted',
                'Papers uploaded before project spaces were introduced.'
            )
            RETURNING id INTO proj_id;
        END IF;

        -- Assign all unlinked papers to it
        UPDATE public.papers
           SET project_id = proj_id
         WHERE user_id   = r.user_id
           AND project_id IS NULL;

        -- Assign all unlinked conversations to it (if table exists)
        BEGIN
            UPDATE public.conversations
               SET project_id = proj_id
             WHERE user_id   = r.user_id
               AND project_id IS NULL;
        EXCEPTION
            WHEN undefined_table THEN
                -- conversations table not yet created (migration 004 not run) — skip
                NULL;
        END;
    END LOOP;

    -- ── Handle users who only have conversations (no papers) ─────────────────
    BEGIN
        FOR r IN
            SELECT DISTINCT user_id
              FROM public.conversations
             WHERE project_id IS NULL
        LOOP
            SELECT id INTO proj_id
              FROM public.projects
             WHERE user_id = r.user_id
               AND name    = 'Unsorted'
             LIMIT 1;

            IF proj_id IS NULL THEN
                INSERT INTO public.projects (user_id, name, description)
                VALUES (
                    r.user_id,
                    'Unsorted',
                    'Conversations started before project spaces were introduced.'
                )
                RETURNING id INTO proj_id;
            END IF;

            UPDATE public.conversations
               SET project_id = proj_id
             WHERE user_id   = r.user_id
               AND project_id IS NULL;
        END LOOP;
    EXCEPTION
        WHEN undefined_table THEN NULL;
    END;
END;
$$;
