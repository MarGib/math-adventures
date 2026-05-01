# Supabase migrations

## Jak to działa

Każdy plik `.sql` w tym katalogu zostaje automatycznie zastosowany na bazie po pushu do `main`. Workflow `.github/workflows/db-migrate.yml`:

1. Łączy się z bazą przez `psql`
2. Iteruje po plikach `0001_*.sql`, `0002_*.sql`, ... w kolejności
3. Każdą migrację rejestruje w tabeli `public._migrations` żeby nie wykonać dwa razy

Plik raz zarejestrowany jako zastosowany jest pomijany. Zmiana zawartości pliku po jego zastosowaniu nie powoduje ponownego uruchomienia (sha256 jest tylko zapisany dla audytu) — lepiej dodać kolejny plik `0003_…` z `alter table` itd.

## Jednorazowy setup (już zrobiony)

Wymagane sekrety w GitHub repo settings → Secrets and variables → Actions:

| Sekret | Skąd | Po co |
|---|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL | Pages config (klient) |
| `SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` | Pages config (klient) |
| `SUPABASE_DB_URL` | Project Settings → Database → Connection String → URI (Direct connection, port 5432) | DB migrations CI |

`SUPABASE_DB_URL` zawiera hasło do bazy — to jedyny secret który ma uprawnienia roota. **Nigdy nie commituj go do repo.** GitHub maskuje go w logach.

## Pisanie nowych migracji

1. Stwórz nowy plik `supabase/migrations/0003_<opis>.sql`
2. Numeracja musi być rosnąca (sortowane alfabetycznie)
3. **Pisz idempotentnie** — `create table if not exists`, `create or replace function`, `drop policy if exists; create policy ...`. Jak workflow wystartuje rerun (np. po cofnięciu commita) nic się nie zepsuje.
4. Push → workflow zastosuje migrację (zobaczysz w Actions)
5. Sprawdź w Supabase Dashboard → Database → Tables, że zmiany wjechały

## Co już mamy

- `0001_init.sql` — `profiles`, `game_results`, RLS, view `user_stats`, `leaderboard_global`, RPC `claim_username`
- `0002_client_info.sql` — kolumna `client_info` JSONB w `game_results`, kolumny `email` i `last_seen_at` na `profiles`, view `device_stats`, `device_summary`, trigger `touch_profile_last_seen`
