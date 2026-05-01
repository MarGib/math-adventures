-- ============================================================
-- Migration 0002 — telemetria urządzeń + multi-device foundation
-- Uruchom w SQL Editor po pierwszej migracji (0001_init.sql)
-- ============================================================

-- ------------------------------------------------------------
-- 1) game_results: client_info JSONB
--    Per gra zapisujemy informacje o urządzeniu — pomaga zrozumieć
--    na jakich ekranach/platformach gra jest najczęściej uruchamiana.
-- ------------------------------------------------------------
alter table public.game_results
    add column if not exists client_info jsonb default '{}'::jsonb;

create index if not exists game_results_client_info_idx
    on public.game_results using gin (client_info);

-- ------------------------------------------------------------
-- 2) profiles: email (opcjonalny — dla multi-device login)
--    Email jest unikalny po stronie auth.users; tutaj trzymamy go
--    do wyświetlania ("Twoje konto: marg@...") i do "find by email".
-- ------------------------------------------------------------
alter table public.profiles
    add column if not exists email text,
    add column if not exists last_seen_at timestamptz;

create index if not exists profiles_email_idx on public.profiles (email);

-- ------------------------------------------------------------
-- 3) View: device_stats — agregaty per platforma + rozdzielczość
--    Bez RLS na widoku, bo bazowa tabela ma RLS i pokazuje tylko
--    dozwolone wiersze (dla anon = wszystkie via game_results SELECT).
-- ------------------------------------------------------------
create or replace view public.device_stats as
select
    coalesce(client_info->>'platform', 'unknown')      as platform,
    coalesce(client_info->>'category', 'unknown')      as category,
    coalesce(client_info->>'screen', 'unknown')        as screen_size,
    coalesce(client_info->>'viewport', 'unknown')      as viewport_size,
    count(*)                                           as games_count,
    count(distinct user_id)                            as players_count,
    sum(score)                                         as total_score,
    avg(score)::numeric(10,1)                          as avg_score
from public.game_results
where client_info <> '{}'::jsonb
group by 1, 2, 3, 4
order by games_count desc;

-- ------------------------------------------------------------
-- 4) View: device_summary — wysokopoziomowy przegląd
-- ------------------------------------------------------------
create or replace view public.device_summary as
select
    coalesce(client_info->>'category', 'unknown') as category,
    count(*)                  as games_count,
    count(distinct user_id)   as players_count,
    round(100.0 * count(*) / nullif((select count(*) from public.game_results
        where client_info <> '{}'::jsonb), 0), 1) as games_pct
from public.game_results
where client_info <> '{}'::jsonb
group by 1
order by games_count desc;

-- ------------------------------------------------------------
-- 5) Trigger: auto-update last_seen_at na profiles po nowej grze
-- ------------------------------------------------------------
create or replace function public.touch_profile_last_seen() returns trigger as $$
begin
    update public.profiles
        set last_seen_at = now()
        where id = new.user_id;
    return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_results_touch_profile on public.game_results;
create trigger trg_results_touch_profile
    after insert on public.game_results
    for each row execute function public.touch_profile_last_seen();

-- ------------------------------------------------------------
-- DONE — sprawdz w Database -> Views ze device_stats i
-- device_summary istnieja. game_results powinno teraz miec
-- column client_info.
-- ------------------------------------------------------------
