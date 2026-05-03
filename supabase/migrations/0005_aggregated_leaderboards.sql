-- ============================================================
-- Migration 0005 — agregowane rankingi (klasa / szkoła / miasto)
-- ============================================================
-- Korzysta z pol school/class_name/city dodanych w 0004.
-- Trzy widoki publiczne, każdy z metrykami:
--   players_count, games_count, total_score, avg_score, best_score, last_played_at

-- ------------------------------------------------------------
-- 1) leaderboard_classes — ranking klas (school + class_name)
-- ------------------------------------------------------------
create or replace view public.leaderboard_classes as
select
    p.school,
    p.class_name,
    count(distinct g.user_id) as players_count,
    count(*) as games_count,
    coalesce(sum(g.score), 0) as total_score,
    coalesce(round(avg(g.score)::numeric, 0), 0)::int as avg_score,
    coalesce(max(g.score), 0) as best_score,
    max(g.played_at) as last_played_at
from public.game_results g
join public.profiles p on p.id = g.user_id
where p.school is not null and p.class_name is not null
group by p.school, p.class_name
order by total_score desc
limit 100;

-- ------------------------------------------------------------
-- 2) leaderboard_schools — ranking szkół
-- ------------------------------------------------------------
create or replace view public.leaderboard_schools as
select
    p.school,
    count(distinct p.class_name) as classes_count,
    count(distinct g.user_id) as players_count,
    count(*) as games_count,
    coalesce(sum(g.score), 0) as total_score,
    coalesce(round(avg(g.score)::numeric, 0), 0)::int as avg_score,
    coalesce(max(g.score), 0) as best_score,
    max(g.played_at) as last_played_at
from public.game_results g
join public.profiles p on p.id = g.user_id
where p.school is not null
group by p.school
order by total_score desc
limit 100;

-- ------------------------------------------------------------
-- 3) leaderboard_cities — ranking miast
-- ------------------------------------------------------------
create or replace view public.leaderboard_cities as
select
    p.city,
    count(distinct p.school) as schools_count,
    count(distinct g.user_id) as players_count,
    count(*) as games_count,
    coalesce(sum(g.score), 0) as total_score,
    coalesce(round(avg(g.score)::numeric, 0), 0)::int as avg_score,
    coalesce(max(g.score), 0) as best_score,
    max(g.played_at) as last_played_at
from public.game_results g
join public.profiles p on p.id = g.user_id
where p.city is not null
group by p.city
order by total_score desc
limit 100;

-- ============================================================
-- DONE
-- ============================================================
