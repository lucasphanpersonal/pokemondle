-- Placeholder pgTAP test so the supabase-test CI job has something to run.
-- Real Party tests (task 4) go in this folder as *.test.sql files.
begin;
select plan(2);

select has_table('public', 'events', 'migrations were applied');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');

select * from finish();
rollback;
