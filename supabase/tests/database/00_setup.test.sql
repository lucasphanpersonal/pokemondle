-- Migrations applied and the pg_cron jobs are scheduled.
begin;
select plan(6);

select has_table('public', 'events', 'analytics migrations were applied');
select has_table('public', 'party_rooms', 'party migration was applied');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select ok(exists (select 1 from cron.job where jobname = 'party-sweep' and schedule = '1 seconds'
                  and command = 'select public.party_sweep()'), 'party-sweep runs every second');
select ok(exists (select 1 from cron.job where jobname = 'party-cleanup' and schedule = '7 * * * *'
                  and command = 'select public.party_cleanup()'), 'party-cleanup runs hourly');
-- With no rooms the sweep finds nothing to do.
select is(public.party_sweep(), 0, 'sweep is a no-op without rooms');

select * from finish();
rollback;
