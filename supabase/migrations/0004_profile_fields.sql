-- ============================================================
-- Migration 0004 — rozszerzony profil + leaderboard z agregatami
-- ============================================================
-- Cel: pola opcjonalne (szkola, klasa, miasto, nr w dzienniku)
-- aby pozniej budowac rankingi szkolne i klasowe (Etap 11).
-- Brak imienia/nazwiska — tylko nick i ten kontekst geograficzny.

-- ------------------------------------------------------------
-- 1) Kolumny w profiles
-- ------------------------------------------------------------
alter table public.profiles
    add column if not exists school text check (school is null or length(school) <= 80),
    add column if not exists class_name text check (
        class_name is null or
        (length(class_name) between 1 and 6 and class_name ~ '^[0-9]+[A-Za-z]*$')
    ),
    add column if not exists city text check (city is null or length(city) <= 60),
    add column if not exists journal_no integer check (
        journal_no is null or (journal_no >= 1 and journal_no <= 99)
    );

create index if not exists profiles_school_idx on public.profiles (school) where school is not null;
create index if not exists profiles_school_class_idx on public.profiles (school, class_name) where school is not null;
create index if not exists profiles_city_idx on public.profiles (city) where city is not null;

-- ------------------------------------------------------------
-- 2) Update widoku leaderboard_global by zawieral school/class/city
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
    p.avatar,
    p.school,
    p.class_name,
    p.city
from public.game_results g
join public.profiles p on p.id = g.user_id
order by g.score desc, g.played_at desc
limit 100;

-- ------------------------------------------------------------
-- 3) Widok user_results — wyniki konkretnego usera (z RLS dla self)
--    UI moze tutaj filtrowac po mode/difficulty
-- ------------------------------------------------------------
create or replace view public.user_results as
select
    g.id,
    g.user_id,
    g.score,
    g.mode,
    g.difficulty,
    g.duration_minutes,
    g.correct_count,
    g.wrong_count,
    g.max_combo,
    g.played_at,
    g.history,
    p.username,
    p.avatar
from public.game_results g
join public.profiles p on p.id = g.user_id;

-- ------------------------------------------------------------
-- 4) RPC: update_profile_extras — atomowy zapis pol opcjonalnych
--    Zwraca jsonb {ok, errors?}. Walidacja po stronie DB,
--    odpornosc na zle dane z klienta.
-- ------------------------------------------------------------
create or replace function public.update_profile_extras(
    p_school text default null,
    p_class_name text default null,
    p_city text default null,
    p_journal_no integer default null,
    p_avatar text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_errors jsonb := '[]'::jsonb;
    v_school text;
    v_class text;
    v_city text;
    v_journal integer;
    v_avatar text;
begin
    if v_user_id is null then
        return jsonb_build_object('ok', false, 'errors', '["not_authenticated"]'::jsonb);
    end if;

    -- Sanitize empty strings -> null
    v_school := nullif(trim(coalesce(p_school, '')), '');
    v_class := nullif(trim(coalesce(p_class_name, '')), '');
    v_city := nullif(trim(coalesce(p_city, '')), '');
    v_journal := p_journal_no;
    v_avatar := nullif(trim(coalesce(p_avatar, '')), '');

    -- Walidacja
    if v_school is not null and length(v_school) > 80 then
        v_errors := v_errors || '["school_too_long"]'::jsonb;
        v_school := substring(v_school from 1 for 80);
    end if;
    if v_class is not null then
        if v_class !~ '^[0-9]+[A-Za-z]*$' then
            v_errors := v_errors || '["class_invalid"]'::jsonb;
            v_class := null;
        end if;
    end if;
    if v_city is not null and length(v_city) > 60 then
        v_city := substring(v_city from 1 for 60);
    end if;
    if v_journal is not null and (v_journal < 1 or v_journal > 99) then
        v_errors := v_errors || '["journal_out_of_range"]'::jsonb;
        v_journal := null;
    end if;

    update public.profiles
    set
        school = v_school,
        class_name = v_class,
        city = v_city,
        journal_no = v_journal,
        avatar = coalesce(v_avatar, avatar)
    where id = v_user_id;

    return jsonb_build_object(
        'ok', true,
        'errors', v_errors,
        'profile', (select row_to_json(p)::jsonb from public.profiles p where p.id = v_user_id)
    );
exception when others then
    return jsonb_build_object('ok', false, 'errors', '["db_error"]'::jsonb, 'detail', SQLERRM);
end;
$$;

grant execute on function public.update_profile_extras(text, text, text, integer, text) to authenticated;

-- ------------------------------------------------------------
-- DONE
-- ------------------------------------------------------------
