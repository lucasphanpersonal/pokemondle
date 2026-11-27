\set ON_ERROR_STOP on
select extname, extversion from pg_extension where extname = 'pg_cron';
select name, default_version, installed_version from pg_available_extensions where name = 'pg_cron';
select version();
show cron.database_name;
create table if not exists public.spike_ticks (id bigserial primary key, ts timestamptz not null default clock_timestamp());
truncate public.spike_ticks;
select cron.schedule('spike-tick', '1 seconds', 'insert into public.spike_ticks default values');
