select cron.unschedule('spike-tick');
with g as (
  select extract(epoch from ts - lag(ts) over (order by id)) * 1000 as gap_ms from public.spike_ticks
)
select count(*) + 1 as ticks,
       round(avg(gap_ms)) as mean_gap_ms,
       round(min(gap_ms)) as min_gap_ms,
       round(percentile_cont(0.5) within group (order by gap_ms)::numeric) as p50_ms,
       round(percentile_cont(0.95) within group (order by gap_ms)::numeric) as p95_ms,
       round(max(gap_ms)) as max_gap_ms,
       round(max(abs(gap_ms - 1000))) as max_jitter_ms
from g where gap_ms is not null;
select round(min(extract(milliseconds from ts)::numeric % 1000)) as min_ms_in_second,
       round(max(extract(milliseconds from ts)::numeric % 1000)) as max_ms_in_second
from public.spike_ticks;
