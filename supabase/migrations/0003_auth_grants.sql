-- ============================================================
-- Migration 0003 — explicit grants + claim_username diagnostic
-- ============================================================
-- Cel: zagwarantowac ze anon i authenticated role mogą wywoływać
-- claim_username RPC. Bez explicit grant Supabase czasem nie pozwala.
-- Plus dodajemy lepsze raportowanie błędu (zamiast cichego false).

-- ------------------------------------------------------------
-- 1) Grant execute na claim_username dla obu roli
-- ------------------------------------------------------------
grant execute on function public.claim_username(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2) Lepszy claim_username — zwraca obiekt z {ok, reason, profile}
--    zamiast samego boolean. Pozwala UI pokazac konkretny blad.
-- ------------------------------------------------------------
create or replace function public.claim_username_v2(
    p_username text,
    p_avatar text default '🦉',
    p_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing_id uuid;
    v_clean_name text;
begin
    if v_user_id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
    end if;

    v_clean_name := trim(p_username);
    if v_clean_name is null or length(v_clean_name) < 2 or length(v_clean_name) > 20 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_length');
    end if;
    if v_clean_name !~ '^[A-Za-z0-9_-]+$' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_chars');
    end if;

    -- Nazwa zajeta przez kogos innego?
    select id into v_existing_id from public.profiles
    where username = v_clean_name and id <> v_user_id;
    if found then
        return jsonb_build_object('ok', false, 'reason', 'taken_by_other');
    end if;

    -- Insert lub update profilu
    insert into public.profiles (id, username, avatar, display_name)
    values (v_user_id, v_clean_name, coalesce(p_avatar, '🦉'), p_display_name)
    on conflict (id) do update set
        username = excluded.username,
        avatar = excluded.avatar,
        display_name = excluded.display_name;

    return jsonb_build_object(
        'ok', true,
        'profile', jsonb_build_object(
            'id', v_user_id,
            'username', v_clean_name,
            'avatar', coalesce(p_avatar, '🦉')
        )
    );
exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'unique_violation');
when others then
    return jsonb_build_object('ok', false, 'reason', 'db_error', 'detail', SQLERRM);
end;
$$;

grant execute on function public.claim_username_v2(text, text, text) to anon, authenticated;
