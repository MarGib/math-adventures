-- ============================================================
-- Migration 0006 — controlled schools + admin tools
-- ============================================================
-- Cel:
--  - szkola z profilu pochodzi ze slownika public.schools
--  - gracze moga zglaszac brakujaca szkole
--  - admin (profil username = MarGib) zatwierdza zgloszenia
--  - admin moze technicznie ustawic nowe haslo uzytkownikowi
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1) Admin guard
-- ------------------------------------------------------------
create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.profiles p
        where p.id = p_user_id
          and lower(p.username) = 'margib'
    );
$$;

grant execute on function public.is_admin(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 2) Schools dictionary
-- ------------------------------------------------------------
create table if not exists public.schools (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) between 3 and 120),
    city text check (city is null or length(trim(city)) between 2 and 80),
    status text not null default 'active' check (status in ('active', 'inactive')),
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists schools_name_city_unique
    on public.schools (lower(trim(name)), lower(coalesce(trim(city), '')))
    where status = 'active';

drop trigger if exists trg_schools_updated on public.schools;
create trigger trg_schools_updated
    before update on public.schools
    for each row execute function public.set_updated_at();

alter table public.schools enable row level security;

drop policy if exists schools_read_active on public.schools;
create policy schools_read_active on public.schools
    for select using (status = 'active' or public.is_admin(auth.uid()));

-- ------------------------------------------------------------
-- 3) Profile link to schools
-- ------------------------------------------------------------
alter table public.profiles
    add column if not exists school_id uuid references public.schools(id) on delete set null;

create index if not exists profiles_school_id_idx on public.profiles (school_id) where school_id is not null;

-- ------------------------------------------------------------
-- 4) School requests
-- ------------------------------------------------------------
create table if not exists public.school_requests (
    id uuid primary key default gen_random_uuid(),
    requester_id uuid not null references public.profiles(id) on delete cascade,
    requested_name text not null check (length(trim(requested_name)) between 3 and 120),
    requested_city text check (requested_city is null or length(trim(requested_city)) between 2 and 80),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    school_id uuid references public.schools(id) on delete set null,
    admin_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz
);

create index if not exists school_requests_status_idx on public.school_requests (status, created_at desc);
create index if not exists school_requests_requester_idx on public.school_requests (requester_id, created_at desc);

drop trigger if exists trg_school_requests_updated on public.school_requests;
create trigger trg_school_requests_updated
    before update on public.school_requests
    for each row execute function public.set_updated_at();

alter table public.school_requests enable row level security;

drop policy if exists school_requests_insert_own on public.school_requests;
create policy school_requests_insert_own on public.school_requests
    for insert with check (auth.uid() = requester_id);

drop policy if exists school_requests_read_own_or_admin on public.school_requests;
create policy school_requests_read_own_or_admin on public.school_requests
    for select using (auth.uid() = requester_id or public.is_admin(auth.uid()));

-- ------------------------------------------------------------
-- 5) User profile update v2
-- ------------------------------------------------------------
create or replace function public.update_profile_extras_v2(
    p_school_id uuid default null,
    p_school_request_name text default null,
    p_school_request_city text default null,
    p_class_name text default null,
    p_city text default null,
    p_journal_no integer default null,
    p_avatar text default null,
    p_clear_school boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_errors jsonb := '[]'::jsonb;
    v_school public.schools%rowtype;
    v_request_name text;
    v_request_city text;
    v_class text;
    v_city text;
    v_journal integer;
    v_avatar text;
    v_request_id uuid;
begin
    if v_user_id is null then
        return jsonb_build_object('ok', false, 'errors', '["not_authenticated"]'::jsonb);
    end if;

    v_request_name := nullif(trim(coalesce(p_school_request_name, '')), '');
    v_request_city := nullif(trim(coalesce(p_school_request_city, '')), '');
    v_class := nullif(upper(trim(coalesce(p_class_name, ''))), '');
    v_city := nullif(trim(coalesce(p_city, '')), '');
    v_journal := p_journal_no;
    v_avatar := nullif(trim(coalesce(p_avatar, '')), '');

    if p_school_id is not null then
        select * into v_school
        from public.schools
        where id = p_school_id and status = 'active';
        if not found then
            v_errors := v_errors || '["school_not_found"]'::jsonb;
            p_school_id := null;
        end if;
    end if;

    if v_class is not null and v_class !~ '^[0-9]+[A-Z]*$' then
        v_errors := v_errors || '["class_invalid"]'::jsonb;
        v_class := null;
    end if;

    if v_city is not null and length(v_city) > 80 then
        v_city := substring(v_city from 1 for 80);
    end if;

    if v_journal is not null and (v_journal < 1 or v_journal > 99) then
        v_errors := v_errors || '["journal_out_of_range"]'::jsonb;
        v_journal := null;
    end if;

    if v_request_name is not null then
        if length(v_request_name) < 3 or length(v_request_name) > 120 then
            v_errors := v_errors || '["school_request_invalid"]'::jsonb;
        else
            insert into public.school_requests (requester_id, requested_name, requested_city)
            values (v_user_id, v_request_name, v_request_city)
            returning id into v_request_id;
        end if;
    end if;

    update public.profiles
    set
        school_id = case when p_clear_school then null when p_school_id is not null then p_school_id else school_id end,
        school = case when p_clear_school then null when p_school_id is not null then v_school.name else school end,
        class_name = v_class,
        city = coalesce(v_city, case when p_school_id is not null then v_school.city else city end),
        journal_no = v_journal,
        avatar = coalesce(v_avatar, avatar)
    where id = v_user_id;

    return jsonb_build_object(
        'ok', true,
        'errors', v_errors,
        'school_request_id', v_request_id,
        'profile', (select row_to_json(p)::jsonb from public.profiles p where p.id = v_user_id)
    );
exception when others then
    return jsonb_build_object('ok', false, 'errors', '["db_error"]'::jsonb, 'detail', SQLERRM);
end;
$$;

grant execute on function public.update_profile_extras_v2(uuid, text, text, text, text, integer, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6) Admin RPC: school queue
-- ------------------------------------------------------------
create or replace function public.admin_get_school_requests()
returns table (
    id uuid,
    requested_name text,
    requested_city text,
    requester_id uuid,
    requester_username text,
    status text,
    school_id uuid,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin(auth.uid()) then
        raise exception 'not_admin';
    end if;

    return query
    select
        r.id,
        r.requested_name,
        r.requested_city,
        r.requester_id,
        p.username as requester_username,
        r.status,
        r.school_id,
        r.created_at
    from public.school_requests r
    join public.profiles p on p.id = r.requester_id
    where r.status = 'pending'
    order by r.created_at asc;
end;
$$;

grant execute on function public.admin_get_school_requests() to authenticated;

create or replace function public.admin_approve_school_request(
    p_request_id uuid,
    p_school_id uuid default null,
    p_school_name text default null,
    p_school_city text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_req public.school_requests%rowtype;
    v_school_id uuid;
    v_name text;
    v_city text;
begin
    if not public.is_admin(auth.uid()) then
        return jsonb_build_object('ok', false, 'reason', 'not_admin');
    end if;

    select * into v_req
    from public.school_requests
    where id = p_request_id and status = 'pending'
    for update;

    if not found then
        return jsonb_build_object('ok', false, 'reason', 'request_not_found');
    end if;

    if p_school_id is not null then
        select id into v_school_id from public.schools where id = p_school_id and status = 'active';
        if v_school_id is null then
            return jsonb_build_object('ok', false, 'reason', 'school_not_found');
        end if;
    else
        v_name := nullif(trim(coalesce(p_school_name, v_req.requested_name)), '');
        v_city := nullif(trim(coalesce(p_school_city, v_req.requested_city)), '');

        insert into public.schools (name, city, created_by)
        values (v_name, v_city, auth.uid())
        on conflict (lower(trim(name)), lower(coalesce(trim(city), ''))) where status = 'active'
        do update set name = excluded.name
        returning id into v_school_id;
    end if;

    update public.school_requests
    set status = 'approved',
        school_id = v_school_id,
        resolved_at = now()
    where id = p_request_id;

    update public.profiles p
    set school_id = s.id,
        school = s.name,
        city = coalesce(p.city, s.city)
    from public.schools s
    where s.id = v_school_id
      and p.id = v_req.requester_id;

    return jsonb_build_object('ok', true, 'school_id', v_school_id);
exception when others then
    return jsonb_build_object('ok', false, 'reason', 'db_error', 'detail', SQLERRM);
end;
$$;

grant execute on function public.admin_approve_school_request(uuid, uuid, text, text) to authenticated;

create or replace function public.admin_reject_school_request(
    p_request_id uuid,
    p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin(auth.uid()) then
        return jsonb_build_object('ok', false, 'reason', 'not_admin');
    end if;

    update public.school_requests
    set status = 'rejected',
        admin_note = p_note,
        resolved_at = now()
    where id = p_request_id and status = 'pending';

    if not found then
        return jsonb_build_object('ok', false, 'reason', 'request_not_found');
    end if;

    return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.admin_reject_school_request(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 7) Admin RPC: direct school create
-- ------------------------------------------------------------
create or replace function public.admin_create_school(
    p_school_name text,
    p_school_city text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := nullif(trim(coalesce(p_school_name, '')), '');
    v_city text := nullif(trim(coalesce(p_school_city, '')), '');
    v_school_id uuid;
begin
    if not public.is_admin(auth.uid()) then
        return jsonb_build_object('ok', false, 'reason', 'not_admin');
    end if;

    if v_name is null or length(v_name) < 3 or length(v_name) > 120 then
        return jsonb_build_object('ok', false, 'reason', 'school_name_invalid');
    end if;

    insert into public.schools (name, city, created_by)
    values (v_name, v_city, auth.uid())
    on conflict (lower(trim(name)), lower(coalesce(trim(city), ''))) where status = 'active'
    do update set updated_at = now()
    returning id into v_school_id;

    return jsonb_build_object('ok', true, 'school_id', v_school_id);
exception when others then
    return jsonb_build_object('ok', false, 'reason', 'db_error', 'detail', SQLERRM);
end;
$$;

grant execute on function public.admin_create_school(text, text) to authenticated;

-- ------------------------------------------------------------
-- 8) Admin RPC: password reset
--    Uwaga: uzywa auth.users i jest chronione przez is_admin().
-- ------------------------------------------------------------
create or replace function public.admin_set_user_password(
    p_username text,
    p_new_password text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
    v_user_id uuid;
begin
    if not public.is_admin(auth.uid()) then
        return jsonb_build_object('ok', false, 'reason', 'not_admin');
    end if;

    if p_new_password is null or length(p_new_password) < 6 then
        return jsonb_build_object('ok', false, 'reason', 'password_too_short');
    end if;

    select id into v_user_id
    from public.profiles
    where lower(username) = lower(trim(p_username));

    if v_user_id is null then
        return jsonb_build_object('ok', false, 'reason', 'user_not_found');
    end if;

    update auth.users
    set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        confirmation_token = '',
        recovery_token = '',
        updated_at = now()
    where id = v_user_id;

    return jsonb_build_object('ok', true, 'user_id', v_user_id);
exception when others then
    return jsonb_build_object('ok', false, 'reason', 'db_error', 'detail', SQLERRM);
end;
$$;

grant execute on function public.admin_set_user_password(text, text) to authenticated;

-- ------------------------------------------------------------
-- 9) Views use approved school names when school_id exists
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
    coalesce(s.name, p.school) as school,
    p.class_name,
    coalesce(p.city, s.city) as city
from public.game_results g
join public.profiles p on p.id = g.user_id
left join public.schools s on s.id = p.school_id
order by g.score desc, g.played_at desc
limit 100;

create or replace view public.leaderboard_schools as
select
    coalesce(s.name, p.school) as school,
    coalesce(p.city, s.city) as city,
    count(distinct p.id) as players_count,
    count(distinct p.class_name) filter (where p.class_name is not null) as classes_count,
    count(g.id) as games_count,
    coalesce(sum(g.score), 0) as total_score,
    coalesce(round(avg(g.score)::numeric, 0), 0)::int as avg_score,
    coalesce(max(g.score), 0) as best_score,
    max(g.played_at) as last_played_at
from public.game_results g
join public.profiles p on p.id = g.user_id
left join public.schools s on s.id = p.school_id
where coalesce(s.name, p.school) is not null
group by coalesce(s.name, p.school), coalesce(p.city, s.city)
order by total_score desc
limit 100;

create or replace view public.leaderboard_classes as
select
    coalesce(s.name, p.school) as school,
    p.class_name,
    coalesce(p.city, s.city) as city,
    count(distinct p.id) as players_count,
    count(g.id) as games_count,
    coalesce(sum(g.score), 0) as total_score,
    coalesce(round(avg(g.score)::numeric, 0), 0)::int as avg_score,
    coalesce(max(g.score), 0) as best_score,
    max(g.played_at) as last_played_at
from public.game_results g
join public.profiles p on p.id = g.user_id
left join public.schools s on s.id = p.school_id
where coalesce(s.name, p.school) is not null and p.class_name is not null
group by coalesce(s.name, p.school), p.class_name, coalesce(p.city, s.city)
order by total_score desc
limit 100;

create or replace view public.leaderboard_cities as
select
    coalesce(p.city, s.city) as city,
    count(distinct coalesce(s.name, p.school)) filter (where coalesce(s.name, p.school) is not null) as schools_count,
    count(distinct g.user_id) as players_count,
    count(*) as games_count,
    coalesce(sum(g.score), 0) as total_score,
    coalesce(round(avg(g.score)::numeric, 0), 0)::int as avg_score,
    coalesce(max(g.score), 0) as best_score,
    max(g.played_at) as last_played_at
from public.game_results g
join public.profiles p on p.id = g.user_id
left join public.schools s on s.id = p.school_id
where coalesce(p.city, s.city) is not null
group by coalesce(p.city, s.city)
order by total_score desc
limit 100;

-- ============================================================
-- DONE
-- ============================================================
