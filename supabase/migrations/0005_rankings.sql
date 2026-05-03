-- ============================================================
-- Migration 0005 — rankingi szkola / klasa / miasto + helper views
-- ============================================================
-- Cel: agregaty per szkola, per klasa (szkola+klasa), per miasto.
-- Plus update user_stats by zawieral school/class/city.

-- ------------------------------------------------------------
-- 1) user_stats — dodajemy school/class_name/city
-- ------------------------------------------------------------
create or replace view public.user_stats as
select
    p.id as user_id,
    p.username,
    p.display_name,
    p.avatar,
    p.school,
    p.class_name,
    p.city,
    count(g.id)                                 as games_played,
    coalesce(sum(g.score), 0)                   as total_score,
    coalesce(max(g.score), 0)                   as best_score,
    coalesce(max(g.max_combo), 0)               as best_combo,
    coalesce(sum(g.correct_count), 0)           as total_correct,
    coalesce(sum(g.wrong_count), 0)             as total_wrong,
    case
        when coalesce(sum(g.correct_count + g.wrong_count), 0) > 0
        then round(100.0 * sum(g.correct_count) / sum(g.correct_count + g.wrong_count), 1)
        else 0
    end                                         as accuracy_pct,
    max(g.played_at)                            as last_played_at
from public.profiles p
left join public.game_results g on g.user_id = p.id
group by p.id, p.username, p.display_name, p.avatar, p.school, p.class_name, p.city;

-- ------------------------------------------------------------
-- 2) ranking_schools — agregaty per szkola
-- ------------------------------------------------------------
create or replace view public.leaderboard_schools as
select
    p.school,
    p.city,
    count(distinct p.id)                                as players_count,
    count(distinct p.class_name) filter (where p.class_name is not null) as classes_count,
    count(g.id)                                         as games_count,
    coalesce(sum(g.score), 0)                           as total_score,
    case
        when count(g.id) > 0
        then round(coalesce(sum(g.score), 0)::numeric / count(g.id), 1)
        else 0
    end                                                 as avg_score,
    coalesce(max(g.score), 0)                           as best_score,
    coalesce(max(g.max_combo), 0)                       as best_combo,
    case
        when coalesce(sum(g.correct_count + g.wrong_count), 0) > 0
        then round(100.0 * sum(g.correct_count) / sum(g.correct_count + g.wrong_count), 1)
        else 0
    end                                                 as accuracy_pct,
    max(g.played_at)                                    as last_played_at
from public.profiles p
left join public.game_results g on g.user_id = p.id
where p.school is not null
group by p.school, p.city
order by total_score desc;

-- ------------------------------------------------------------
-- 3) ranking_classes — agregaty per szkola+klasa
-- ------------------------------------------------------------
create or replace view public.leaderboard_classes as
select
    p.school,
    p.class_name,
    p.city,
    count(distinct p.id)                                as players_count,
    count(g.id)                                         as games_count,
    coalesce(sum(g.score), 0)                           as total_score,
    case
        when count(g.id) > 0
        then round(coalesce(sum(g.score), 0)::numeric / count(g.id), 1)
        else 0
    end                                                 as avg_score,
    coalesce(max(g.score), 0)                           as best_score,
    coalesce(max(g.max_combo), 0)                       as best_combo,
    case
        when coalesce(sum(g.correct_count + g.wrong_count), 0) > 0
        then round(100.0 * sum(g.correct_count) / sum(g.correct_count + g.wrong_count), 1)
        else 0
    end                                                 as accuracy_pct,
    max(g.played_at)                                    as last_played_at
from public.profiles p
left join public.game_results g on g.user_id = p.id
where p.school is not null and p.class_name is not null
group by p.school, p.class_name, p.city
order by total_score desc;

-- ------------------------------------------------------------
-- 4) ranking_cities — agregaty per miasto
-- ------------------------------------------------------------
create or replace view public.leaderboard_cities as
select
    p.city,
    count(distinct p.id)                                as players_count,
    count(distinct p.school) filter (where p.school is not null) as schools_count,
    count(g.id)                                         as games_count,
    coalesce(sum(g.score), 0)                           as total_score,
    case
        when count(g.id) > 0
        then round(coalesce(sum(g.score), 0)::numeric / count(g.id), 1)
        else 0
    end                                                 as avg_score,
    coalesce(max(g.score), 0)                           as best_score,
    case
        when coalesce(sum(g.correct_count + g.wrong_count), 0) > 0
        then round(100.0 * sum(g.correct_count) / sum(g.correct_count + g.wrong_count), 1)
        else 0
    end                                                 as accuracy_pct,
    max(g.played_at)                                    as last_played_at
from public.profiles p
left join public.game_results g on g.user_id = p.id
where p.city is not null
group by p.city
order by total_score desc;

-- ------------------------------------------------------------
-- DONE — sprawdz w Database -> Views ze leaderboard_schools,
-- leaderboard_classes, leaderboard_cities sa widoczne, oraz
-- user_stats wzbogacony o szkole/klase/miasto.
-- ------------------------------------------------------------
