-- ============================================================
-- Matematyczna Przygoda — Schemat bazy
-- Uruchom raz w SQL Editor w Supabase Dashboard
-- (Project → SQL Editor → New query → wklej całość → Run)
-- ============================================================

-- ------------------------------------------------------------
-- 1) PROFILES
--    Profil gracza, podpięty 1:1 do auth.users (anonimowy auth).
--    Username jest unikalny w skali projektu (rezerwacja).
-- ------------------------------------------------------------
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique not null check (
        char_length(username) between 2 and 20 and
        username ~ '^[A-Za-z0-9_-]+$'
    ),
    display_name text,
    avatar text not null default '🦉',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (username);

-- Auto-update updated_at on row update
create or replace function public.set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
    before update on public.profiles
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2) GAME RESULTS
--    Każda zakończona sesja gry. history jako JSONB —
--    pełne pytania + odpowiedzi do replay.
-- ------------------------------------------------------------
create table if not exists public.game_results (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,

    -- Wynik i metadata
    score integer not null check (score >= 0),
    mode text not null check (mode in ('add','sub','mul','div','mix')),
    difficulty text not null check (difficulty in ('easy','medium','hard')),
    duration_minutes integer not null check (duration_minutes >= 0),

    -- Statystyki sesji
    correct_count integer not null default 0 check (correct_count >= 0),
    wrong_count integer not null default 0 check (wrong_count >= 0),
    max_combo integer not null default 0 check (max_combo >= 0),

    -- Pełna historia
    history jsonb not null default '[]'::jsonb,

    played_at timestamptz not null default now()
);

create index if not exists game_results_user_id_idx on public.game_results (user_id);
create index if not exists game_results_played_at_idx on public.game_results (played_at desc);
create index if not exists game_results_score_idx on public.game_results (score desc);
create index if not exists game_results_mode_diff_idx on public.game_results (mode, difficulty);

-- ------------------------------------------------------------
-- 3) USER STATS — VIEW
--    Agregaty per-użytkownik: liczba gier, łączny wynik,
--    średnia skuteczność, najlepsze combo, ostatnia gra.
-- ------------------------------------------------------------
create or replace view public.user_stats as
select
    p.id as user_id,
    p.username,
    p.display_name,
    p.avatar,
    count(g.id)                                   as games_played,
    coalesce(sum(g.score), 0)                     as total_score,
    coalesce(max(g.score), 0)                     as best_score,
    coalesce(max(g.max_combo), 0)                 as best_combo,
    coalesce(sum(g.correct_count), 0)             as total_correct,
    coalesce(sum(g.wrong_count), 0)               as total_wrong,
    case
        when coalesce(sum(g.correct_count + g.wrong_count), 0) > 0
        then round(100.0 * sum(g.correct_count) / sum(g.correct_count + g.wrong_count), 1)
        else 0
    end                                           as accuracy_pct,
    max(g.played_at)                              as last_played_at
from public.profiles p
left join public.game_results g on g.user_id = p.id
group by p.id, p.username, p.display_name, p.avatar;

-- ------------------------------------------------------------
-- 4) GLOBAL LEADERBOARD — VIEW
--    Top wyniki z imionami / awatarami (do publicznego pokazania).
-- ------------------------------------------------------------
create or replace view public.leaderboard_global as
select
    g.id,
    g.score,
    g.mode,
    g.difficulty,
    g.duration_minutes,
    g.correct_count,
    g.wrong_count,
    g.max_combo,
    g.played_at,
    p.username,
    p.display_name,
    p.avatar
from public.game_results g
join public.profiles p on p.id = g.user_id
order by g.score desc, g.played_at desc
limit 100;

-- ------------------------------------------------------------
-- 5) RPC: claim_username
--    Atomowo rezerwuje username dla bieżącego usera.
--    Zwraca true gdy się udało, false gdy zajęte.
-- ------------------------------------------------------------
create or replace function public.claim_username(
    p_username text,
    p_avatar text default '🦉',
    p_display_name text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing uuid;
begin
    if v_user_id is null then
        raise exception 'Wymagane logowanie';
    end if;

    -- Sprawdz czy username juz wzieta przez innego usera
    select id into v_existing from public.profiles
    where username = p_username and id <> v_user_id;
    if found then
        return false;
    end if;

    -- Insert lub update profilu zalogowanego usera
    insert into public.profiles (id, username, avatar, display_name)
    values (v_user_id, p_username, coalesce(p_avatar, '🦉'), p_display_name)
    on conflict (id) do update set
        username = excluded.username,
        avatar = excluded.avatar,
        display_name = excluded.display_name;

    return true;
exception when unique_violation then
    return false;
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.game_results enable row level security;

-- profiles: kazdy moze czytac (do leaderboarda), edytowac tylko swoje
drop policy if exists profiles_read_all on public.profiles;
create policy profiles_read_all on public.profiles
    for select using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
    for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update using (auth.uid() = id) with check (auth.uid() = id);

-- game_results: kazdy moze czytac (publiczny leaderboard),
-- insert tylko z wlasnym user_id, brak update/delete
drop policy if exists game_results_read_all on public.game_results;
create policy game_results_read_all on public.game_results
    for select using (true);

drop policy if exists game_results_insert_own on public.game_results;
create policy game_results_insert_own on public.game_results
    for insert with check (auth.uid() = user_id);

-- Brak polityki UPDATE / DELETE -> niemozliwe dla anon i zwyklego usera

-- ============================================================
-- AUTH SETTINGS (instrukcja, nie SQL)
-- ============================================================
-- W Supabase Dashboard:
-- 1) Authentication -> Providers -> Email: pozostaw wlaczone
-- 2) Authentication -> Providers -> Anonymous Sign-Ins: WLACZ
--    (to pozwala graczom zaczac gre bez emaila)
-- 3) Authentication -> URL Configuration -> Site URL:
--    https://margib.github.io/math-adventures/
-- 4) (Opcjonalnie) Email -> Custom email templates dla magic link

-- ============================================================
-- DONE — sprawdz w Database -> Tables ze profiles i game_results
-- istnieja oraz w Database -> Functions ze claim_username istnieje.
-- ============================================================
