/* ============================================================
   Matematyczna Przygoda — app.js
   Logika gry (zachowana 1:1) + efekty wizualne
   ============================================================ */

(function () {
    'use strict';

    /* ---------- Stałe ---------- */
    const quotes = [
        "Matematyka to supermoc! 🦸‍♂️",
        "Liczby nie gryzą! 🔢",
        "Trening czyni mistrza! 🏆",
        "Dajesz radę! 💪",
        "Myślenie ma przyszłość! 💡",
        "Mózg lubi wyzwania! 🧠",
        "Każda odpowiedź to krok dalej! 🚀"
    ];

    const rewardsList = ["🍬", "🍭", "🍪", "🍩", "🍦", "🎮", "🚀", "🦄", "👑", "💎", "🧸", "🎁", "⚽", "🎸", "🎨"];
    const rewardMilestones = [10, 15, 20, 25, 30, 35, 40, 45, 50, 100];
    const storageKey = "mathHeroV16";
    const legacyStorageKey = "mathHeroV15";
    const lastUserKey = "mathHeroLastUser";

    /* ============================================================
       SUPABASE — opcjonalna chmurowa synchronizacja
       Aplikacja w pelni dziala bez Supabase (offline only). Jezeli
       config.js dostarcza klucze i ENABLE_CLOUD=true, dodatkowo
       zapisujemy wyniki do bazy i pokazujemy globalny leaderboard.
       ============================================================ */
    const cloudConfig = (window.MATH_ADV_CONFIG || {});
    const CLOUD_ENABLED = !!(cloudConfig.ENABLE_CLOUD &&
        cloudConfig.SUPABASE_URL && cloudConfig.SUPABASE_ANON_KEY &&
        window.supabase);

    let sb = null;            // klient Supabase
    let cloudUser = null;     // { id, username, avatar }
    let cloudReady = false;   // true gdy uda sie auth + profile load

    async function initCloud() {
        if (!CLOUD_ENABLED) return;
        try {
            sb = window.supabase.createClient(
                cloudConfig.SUPABASE_URL,
                cloudConfig.SUPABASE_ANON_KEY,
                { auth: { persistSession: true, autoRefreshToken: true } }
            );

            const { data: { session } } = await sb.auth.getSession();
            if (!session) {
                const { error } = await sb.auth.signInAnonymously();
                if (error) throw error;
            }
            cloudReady = true;
            await refreshCloudUser();

            // Jezeli zalogowany trwale i mamy profile -> ustaw user state z tego
            if (cloudUser && cloudUser._persistent && cloudUser.profile) {
                user.name = cloudUser.profile.username;
                user.avatar = cloudUser.profile.avatar || user.avatar;
                // Aktualizuj UI (avatar grid + form)
                const usernameInput = document.getElementById('username');
                if (usernameInput) usernameInput.value = user.name;
                document.querySelectorAll('.avatar-option').forEach(el => {
                    el.classList.toggle('selected', el.textContent.trim() === user.avatar);
                });
            }

            // Realtime sluchanie zmian sesji (sign in z innej karty etc.)
            sb.auth.onAuthStateChange(async () => {
                await refreshCloudUser();
                updateCloudStatusPill();
            });
        } catch (e) {
            console.warn('[cloud] init failed, going offline-only:', e && e.message);
            cloudReady = false;
        }
    }

    /** Próbuje zarezerwować nazwę gracza w chmurze.
        Najpierw probuje claim_username_v2 (zwraca jsonb z reason),
        fallback na stara claim_username (zwraca boolean).
        Returns: { ok: bool, reason?: string, profile?: object } */
    async function cloudClaimUsername(username, avatar) {
        if (!cloudReady) return { ok: false, reason: 'no_cloud' };
        const av = avatar || '🦉';

        // PRIMARY: direct UPSERT na profiles. RLS pozwala authenticated user-owi
        // INSERT/UPDATE własnego profilu (auth.uid() = id). Dużo szybsze niż RPC.
        try {
            const { data: sessData } = await sb.auth.getSession();
            const uid = sessData && sessData.session && sessData.session.user && sessData.session.user.id;
            if (!uid) {
                // Brak sesji — nie możemy zrobić direct, padnij do RPC
                throw new Error('no-session');
            }

            const { data, error } = await withFallbackTimeout(
                sb
                .from('profiles')
                .upsert({ id: uid, username, avatar: av, display_name: username }, { onConflict: 'id' })
                .select()
                .single(),
                7000,
                { data: null, error: { message: 'timeout' } }
            );

            if (!error && data) {
                if (cloudUser) cloudUser.profile = data;
                return { ok: true, profile: data };
            }
            // Unique violation na username = nazwa zajęta
            if (error && (error.code === '23505' || /unique|duplicate/i.test(error.message || ''))) {
                return { ok: false, reason: 'taken_by_other' };
            }
            console.warn('[cloud] direct upsert failed, falling back to RPC:', error && error.message);
        } catch (e) {
            console.warn('[cloud] direct upsert threw, falling back to RPC:', e && e.message);
        }

        // FALLBACK: RPC v2 (gdy direct nie zadziała — np. inne RLS, dziwny stan sesji)
        try {
            const { data, error } = await withFallbackTimeout(
                sb.rpc('claim_username_v2', {
                    p_username: username,
                    p_avatar: av,
                    p_display_name: username
                }),
                9000,
                { data: null, error: { message: 'timeout' } }
            );
            if (!error && data && typeof data === 'object') {
                if (data.ok && cloudUser) cloudUser.profile = data.profile;
                return data;
            }
            if (error) throw error;
        } catch (e) {
            console.warn('[cloud] claim_username_v2 threw:', e && e.message);
        }

        // FALLBACK 2: RPC v1
        try {
            const { data, error } = await withFallbackTimeout(
                sb.rpc('claim_username', {
                    p_username: username,
                    p_avatar: av,
                    p_display_name: username
                }),
                9000,
                { data: null, error: { message: 'timeout' } }
            );
            if (error) throw error;
            if (data === true) {
                if (cloudUser) cloudUser.profile = { username, avatar: av, display_name: username };
                return { ok: true, profile: { username, avatar: av, display_name: username } };
            }
            return { ok: false, reason: 'taken_by_other' };
        } catch (e) {
            console.warn('[cloud] all claim attempts failed:', e && e.message);
            return { ok: false, reason: 'rpc_error', detail: e && e.message };
        }
    }

    /** Telemetria urządzenia — co my zapisujemy dla każdej gry.
        UA jest skracane do 220 znaków, nie zbieramy IP (Supabase RLS
        i tak nie da klientowi tej info). Kategoria pomaga grupować. */
    function getClientInfo() {
        const sw = window.screen ? screen.width : 0;
        const sh = window.screen ? screen.height : 0;
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const dpr = window.devicePixelRatio || 1;
        const ua = (navigator.userAgent || '').substring(0, 220);
        const lang = navigator.language || '';
        let tz = '';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}

        // Prosta kategoryzacja po szerokości viewportu i UA
        let category = 'desktop';
        if (/iPhone|iPod|Android.*Mobile/i.test(ua) || vw < 540) category = 'phone';
        else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua) || vw < 1024) category = 'tablet';

        let platform = 'other';
        if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) platform = 'iOS';
        else if (/Android/i.test(ua)) platform = 'Android';
        else if (/Mac/i.test(ua)) platform = 'macOS';
        else if (/Windows/i.test(ua)) platform = 'Windows';
        else if (/Linux/i.test(ua)) platform = 'Linux';

        return {
            screen: `${sw}x${sh}`,
            viewport: `${vw}x${vh}`,
            dpr: Math.round(dpr * 100) / 100,
            category,
            platform,
            lang,
            tz,
            ua,
            ts: new Date().toISOString()
        };
    }

    /** Promise ostatniego zapisu do bazy — pozwala innym funkcjom poczekac
        az dane sie skomituja przed nastepnym fetch'em (eliminuje race "saved
        but not yet visible in leaderboard"). */
    let lastCloudSavePromise = Promise.resolve();

    async function cloudSaveResult(result) {
        if (!cloudReady || !cloudUser || !cloudUser.profile) return Promise.resolve();
        const savePromise = (async () => {
            try {
                const correct = result.history.filter(h => h.ok).length;
                const wrong = result.history.length - correct;
                let maxCombo = 0, c = 0;
                for (const h of result.history) {
                    if (h.ok) { c++; if (c > maxCombo) maxCombo = c; } else c = 0;
                }
                const { error } = await sb.from('game_results').insert({
                    user_id: cloudUser.id,
                    score: result.score,
                    mode: result.mode,
                    difficulty: result.difficulty,
                    duration_minutes: result.timeMin,
                    correct_count: correct,
                    wrong_count: wrong,
                    max_combo: maxCombo,
                    history: result.history,
                    client_info: getClientInfo()
                });
                if (error) throw error;
            } catch (e) {
                console.warn('[cloud] save failed:', e && e.message);
            }
        })();
        lastCloudSavePromise = savePromise;
        return savePromise;
    }

    /** Sprawdza czy nazwa jest wolna. Zwraca: 'free' | 'taken' | 'mine' | null (gdy bez chmury). */
    async function cloudCheckUsername(name) {
        if (!cloudReady || !sb) return null;
        const trimmed = (name || '').trim();
        if (trimmed.length < 2) return null;
        try {
            const { data, error } = await sb
                .from('profiles')
                .select('id')
                .eq('username', trimmed)
                .maybeSingle();
            if (error) return null;
            if (!data) return 'free';
            if (cloudUser && data.id === cloudUser.id) return 'mine';
            return 'taken';
        } catch (e) {
            return null;
        }
    }

    /** Generator losowej nazwy. Łączy przymiotnik + rzeczownik + opcjonalnie cyfra. */
    const namePartAdj = ['Sprytny','Madry','Szybki','Dzielny','Bystry','Czujny','Silny','Wesoly','Dziarski','Odwazny','Zwinny','Cierpliwy','Pewny','Pilny','Lotny','Sprawny','Niezlomny','Raczy','Jasny','Smialy'];
    const namePartNoun = ['Sowa','Lis','Tygrys','Smok','Panda','Jelen','Rys','Wilk','Wieloryb','Sokol','Kot','Pies','Konik','Niedzwiedz','Geniusz','Bohater','Wojownik','Medrzec','Profesor','Mistrz'];

    function generateRandomName() {
        const adj = namePartAdj[Math.floor(Math.random() * namePartAdj.length)];
        const noun = namePartNoun[Math.floor(Math.random() * namePartNoun.length)];
        const suffix = Math.random() < 0.65 ? Math.floor(Math.random() * 99) : '';
        return `${adj}${noun}${suffix}`;
    }

    /** Sugestie alternatyw dla zajętej nazwy. */
    function suggestAlternatives(takenName) {
        const base = (takenName || '').replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '');
        const out = new Set();
        // 1) base + 2-3 cyfry
        out.add(`${base}${Math.floor(Math.random() * 90 + 10)}`);
        out.add(`${base}_${Math.floor(Math.random() * 900 + 100)}`);
        // 2) przymiotnik + base
        const adj = namePartAdj[Math.floor(Math.random() * namePartAdj.length)];
        out.add(`${adj}${base}`);
        // 3) całkiem losowa
        out.add(generateRandomName());
        return [...out].filter(n => n.length >= 2 && n.length <= 20).slice(0, 3);
    }

    /** Race fetch z timeoutem. Po X ms odrzucamy promise i zwracamy fallback.
        Bardzo wazne na flakey network — bez tego UI moze zwisac na "Wczytuję..." */
    function withFallbackTimeout(promise, ms, fallback) {
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('CLOUD_TIMEOUT')), ms || 5000);
        });
        return Promise.race([promise, timeoutPromise])
            .then(v => { clearTimeout(timer); return v; })
            .catch(err => {
                clearTimeout(timer);
                console.warn('[cloud] timeout/error:', err && err.message);
                return fallback;
            });
    }

    async function cloudFetchGlobalTop(limit, modeFilter) {
        if (!cloudReady) return [];
        const doFetch = async () => {
            let q = sb.from('leaderboard_global').select('*');
            if (modeFilter && modeFilter !== 'all') q = q.eq('mode', modeFilter);
            q = q.limit(limit || 20);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        };
        return await withFallbackTimeout(doFetch(), 5000, []);
    }

    /** Pobierz wyniki ZALOGOWANEGO usera z bazy (cross-device sync).
        Default sort: played_at DESC (najnowsze na górze) — historia gier.
        Override przez sortBy: 'score' aby dostać top-N. */
    async function cloudFetchMyResults(limit, modeFilter, sortBy) {
        if (!cloudReady || !cloudUser) return [];
        const doFetch = async () => {
            let q = sb.from('game_results')
                .select('*')
                .eq('user_id', cloudUser.id);
            if (sortBy === 'score') {
                q = q.order('score', { ascending: false }).order('played_at', { ascending: false });
            } else {
                q = q.order('played_at', { ascending: false });
            }
            if (modeFilter && modeFilter !== 'all') q = q.eq('mode', modeFilter);
            q = q.limit(limit || 20);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        };
        return await withFallbackTimeout(doFetch(), 5000, []);
    }

    /** Fetch agregowanych rankingów (klasy/szkoły/miasta). */
    async function cloudFetchAggregated(view, limit) {
        if (!cloudReady) return [];
        const doFetch = async () => {
            const { data, error } = await sb.from(view).select('*').limit(limit || 50);
            if (error) throw error;
            return data || [];
        };
        return await withFallbackTimeout(doFetch(), 5000, []);
    }

    /** Top wyniki w danej szkole. */
    async function cloudFetchSchoolTop(school, limit, modeFilter) {
        if (!cloudReady || !school) return [];
        try {
            let q = sb.from('leaderboard_global').select('*').eq('school', school);
            if (modeFilter && modeFilter !== 'all') q = q.eq('mode', modeFilter);
            q = q.limit(limit || 20);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[cloud] fetch school top failed', e && e.message);
            return [];
        }
    }

    /** Top wyniki w danej klasie (school + class_name). */
    async function cloudFetchClassTop(school, className, limit, modeFilter) {
        if (!cloudReady || !school || !className) return [];
        try {
            let q = sb.from('leaderboard_global').select('*')
                .eq('school', school).eq('class_name', className);
            if (modeFilter && modeFilter !== 'all') q = q.eq('mode', modeFilter);
            q = q.limit(limit || 20);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[cloud] fetch class top failed', e && e.message);
            return [];
        }
    }

    /** Top wyniki w danym mieście. */
    async function cloudFetchCityTop(city, limit, modeFilter) {
        if (!cloudReady || !city) return [];
        try {
            let q = sb.from('leaderboard_global').select('*').eq('city', city);
            if (modeFilter && modeFilter !== 'all') q = q.eq('mode', modeFilter);
            q = q.limit(limit || 20);
            const { data, error } = await q;
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[cloud] fetch city top failed', e && e.message);
            return [];
        }
    }

    /** Rankingi agregowane: top szkół / klas / miast. */
    async function cloudFetchRanking(kind, limit) {
        if (!cloudReady) return [];
        const view = { schools: 'ranking_schools', classes: 'ranking_classes', cities: 'ranking_cities' }[kind];
        if (!view) return [];
        try {
            const { data, error } = await sb.from(view).select('*').limit(limit || 20);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn(`[cloud] fetch ranking ${kind} failed`, e && e.message);
            return [];
        }
    }

    /** Update profilu (school/class/city/journal/avatar) przez RPC. */
    async function cloudUpdateProfile(fields) {
        if (!cloudReady) throw new Error('Brak połączenia z chmurą');
        if (!cloudUser || !cloudUser._persistent) {
            throw new Error('Najpierw stwórz konto trwałe (Konto → Stwórz konto)');
        }
        const { data, error } = await sb.rpc('update_profile_extras', {
            p_school: fields.school || null,
            p_class_name: fields.class_name || null,
            p_city: fields.city || null,
            p_journal_no: fields.journal_no || null,
            p_avatar: fields.avatar || null,
        });
        if (error) throw error;
        if (!data || !data.ok) {
            const errs = (data && data.errors) || [];
            throw new Error('Walidacja: ' + errs.join(', '));
        }
        await refreshCloudUser();
        return cloudUser;
    }

    /* ---- Auth: username + password (synthetic email) ----
       Supabase auth wymaga email; fabrykujemy go z username i wewnetrznej
       domeny .invalid (ktora nigdy nie istnieje w prawdziwym DNS). Email
       opcjonalny do recovery jest TRZYMANY OBOK — w profile.email kolumna.
       Anonimowy user moze upgrade'owac konto bez tracenia danych przez
       updateUser({email, password}) — UID zostaje. */
    function syntheticEmailFor(username) {
        const safe = String(username).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return `${safe}@math-adv.invalid`;
    }

    function isPersistentUser() {
        // Persistent = ma email/haslo (czyli nie jest is_anonymous w aud)
        if (!cloudReady || !sb) return false;
        // Supabase v2: user.is_anonymous = true gdy signInAnonymously
        const u = (sb.auth.getUser ? null : null);
        // Poniewaz getUser jest async, sprawdzamy z lokalnej zmiennej
        return !!(cloudUser && cloudUser.profile && cloudUser._persistent);
    }

    async function refreshCloudUser() {
        if (!sb) return;
        try {
            const { data: { user: u } } = await sb.auth.getUser();
            if (!u) { cloudUser = null; return; }
            const { data: profile } = await sb
                .from('profiles')
                .select('id, username, avatar, display_name, email, school, class_name, city, journal_no')
                .eq('id', u.id)
                .maybeSingle();
            cloudUser = {
                id: u.id,
                profile,
                _persistent: !u.is_anonymous,
                _email: u.email
            };
        } catch (e) {
            console.warn('[cloud] refreshCloudUser failed', e && e.message);
        }
    }

    /** Wraps a promise with a timeout. Rejects after `ms` if not settled. */
    function withRejectingTimeout(promise, ms, label) {
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`${label || 'Operacja'} — przekroczono czas (${ms}ms)`);
                err.code = 'CLIENT_TIMEOUT';
                reject(err);
            }, ms);
        });
        return Promise.race([promise, timeoutPromise])
            .finally(() => clearTimeout(timer));
    }

    function isTimeoutError(err) {
        return !!(err && (err.code === 'CLIENT_TIMEOUT' || err.message === 'CLOUD_TIMEOUT' || /przekroczono czas/i.test(err.message || '')));
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForSessionUser(matches, totalMs) {
        const started = Date.now();
        while (Date.now() - started < totalMs) {
            try {
                const { data: sessData } = await sb.auth.getSession();
                const u = sessData && sessData.session && sessData.session.user;
                if (u && matches(u)) return u;
            } catch (_) {}
            await sleep(600);
        }
        return null;
    }

    async function authRequestWithRecovery(requestPromise, ms, label, matchesSessionUser, onRecovering) {
        try {
            return await withRejectingTimeout(requestPromise, ms, label);
        } catch (e) {
            if (!isTimeoutError(e)) throw e;
            if (onRecovering) onRecovering();
            const recoveredUser = await waitForSessionUser(matchesSessionUser, 12000);
            if (recoveredUser) {
                console.warn(`[cloud] ${label} timed out, recovered from local session`);
                return { data: { user: recoveredUser }, error: null, recovered: true };
            }
            throw e;
        }
    }

    /** Sign-up z verbose progress. onStep(text) opcjonalny callback do UI.
        Każdy krok ma własny timeout — żaden zawieszony request nie blokuje całego flow.
        Pomijamy redundantny pre-check nazwy: cloudClaimUsername (RPC) jest atomowy,
        a sb.auth.signUp/updateUser zwróci błąd duplikatu jeśli nazwa zajęta. */
    async function cloudSignUp(username, password, email, onStep) {
        const step = (text) => { if (onStep) onStep(text); };
        if (!cloudReady) throw new Error('Chmura niedostępna');
        const synth = syntheticEmailFor(username);

        // getSession() czyta lokalny JWT — natychmiastowe, bez network call.
        // (getUser() weryfikuje token na serwerze i potrafi wisieć na cold-start.)
        const { data: sessData } = await sb.auth.getSession();
        const current = sessData && sessData.session && sessData.session.user;

        let resultUser;
        // Recovery case: poprzednia próba utworzyła auth ale claim padł.
        // Jeśli już jesteśmy zalogowani jako ten user (po emailu), pomiń tworzenie.
        const alreadyThisUser = current && !current.is_anonymous && current.email === synth;

        if (alreadyThisUser) {
            step('Wznawiam rezerwację (konto już istnieje)...');
            resultUser = current;
        } else if (current && current.is_anonymous) {
            step('Aktualizuję anonimowe konto (zachowuję wyniki)...');
            const { data, error } = await authRequestWithRecovery(
                sb.auth.updateUser({ email: synth, password }),
                30000,
                'updateUser',
                (u) => !!(u && !u.is_anonymous && u.email === synth),
                () => step('Supabase odpowiada wolno — sprawdzam czy konto już powstało...')
            );
            if (error) {
                console.error('[cloud] updateUser error:', error);
                if (/email.*already|registered|exists/i.test(error.message)) {
                    throw new Error(`Nazwa "${username}" jest już zajęta. Wybierz inną lub zaloguj się.`);
                }
                if (/confirm/i.test(error.message)) {
                    throw new Error('Konto wymaga potwierdzenia email — wyłącz "Confirm email" w Supabase Auth.');
                }
                throw new Error(error.message || 'Aktualizacja konta nie powiodła się');
            }
            resultUser = data && data.user;
            if (!resultUser) {
                throw new Error('Nie udało się potwierdzić utworzenia konta. Spróbuj ponownie za chwilę.');
            }
            if (resultUser && resultUser.is_anonymous) {
                throw new Error('Konto wciąż anonimowe — wyłącz "Confirm email" w Supabase Auth → Email.');
            }
        } else {
            step('Tworzę nowe konto...');
            const { data, error } = await authRequestWithRecovery(
                sb.auth.signUp({ email: synth, password }),
                30000,
                'signUp',
                (u) => !!(u && !u.is_anonymous && u.email === synth),
                () => step('Supabase odpowiada wolno — sprawdzam czy konto już powstało...')
            );
            if (error) {
                console.error('[cloud] signUp error:', error);
                if (/registered|exists|already/i.test(error.message)) {
                    throw new Error(`Nazwa "${username}" jest już zajęta. Wybierz inną lub zaloguj się.`);
                }
                throw new Error(error.message || 'Rejestracja nie powiodła się');
            }
            resultUser = data && data.user;
            if (!resultUser) {
                throw new Error('Konto wymaga potwierdzenia email — wyłącz "Confirm email" w Supabase Auth.');
            }
        }

        step('Odświeżam sesję...');
        await withRejectingTimeout(sb.auth.refreshSession(), 5000, 'refreshSession').catch((e) => {
            console.warn('[cloud] refreshSession skipped:', e && e.message);
        });

        step('Rezerwuję nazwę...');
        // Retry raz — pierwszy RPC po signUp często cold-startuje (2-5s),
        // drugi przelatuje natychmiast.
        let claim;
        try {
            claim = await withRejectingTimeout(cloudClaimUsername(username, user.avatar), 22000, 'claimUsername');
        } catch (e) {
            console.warn('[cloud] claimUsername first attempt failed, retrying:', e && e.message);
            step('Rezerwuję nazwę (ponawiam)...');
            claim = await withRejectingTimeout(cloudClaimUsername(username, user.avatar), 22000, 'claimUsername-retry');
        }
        if (!claim.ok) {
            const reason = claim.reason || 'unknown';
            const reasonText = {
                taken_by_other: `Nazwa "${username}" jest już zajęta`,
                not_authenticated: 'Brak sesji — odśwież stronę',
                invalid_length: 'Nazwa musi mieć 2-20 znaków',
                invalid_chars: 'Tylko litery, cyfry, _ i -',
                rpc_error: 'Błąd bazy: ' + (claim.detail || ''),
                no_cloud: 'Brak połączenia z chmurą'
            }[reason] || `Nie udało się zarezerwować (${reason})`;
            throw new Error(reasonText);
        }

        cloudUser = {
            id: resultUser.id,
            profile: claim.profile || (cloudUser && cloudUser.profile) || {
                id: resultUser.id,
                username,
                avatar: user.avatar || '🦉',
                display_name: username
            },
            _persistent: !resultUser.is_anonymous,
            _email: resultUser.email
        };

        if (email && email.trim()) {
            step('Zapisuję email do odzyskiwania...');
            try {
                await withRejectingTimeout(
                    sb.from('profiles').update({ email: email.trim().toLowerCase() }).eq('id', resultUser.id),
                    4000, 'saveEmail'
                );
            } catch (e) {
                console.warn('[cloud] email save failed:', e && e.message);
                // Nie blokujemy — email do recovery to "nice to have"
            }
        }

        step('Finalizuję...');
        await withRejectingTimeout(refreshCloudUser(), 6000, 'refreshCloudUser').catch((e) => {
            console.warn('[cloud] refreshCloudUser skipped:', e && e.message);
        });
        return cloudUser;
    }

    /** Sign-in. NIE robi globalnego signOut — kazde urzadzenie ma wlasna
        sesje. Jezeli jest aktywna sesja (anon albo inny user), sygnaczemy
        ja LOKALNIE dopiero gdy zlogujemy nowego usera (atomowo). */
    async function cloudSignIn(username, password, onStep) {
        const step = (t) => { if (onStep) onStep(t); };
        if (!cloudReady) throw new Error('Chmura niedostępna');
        const synth = syntheticEmailFor(username);

        step('Loguję na konto...');
        const { data, error } = await withRejectingTimeout(
            sb.auth.signInWithPassword({ email: synth, password }),
            8000, 'signInWithPassword'
        );
        if (error) {
            console.error('[cloud] signIn error:', error);
            if (/Invalid login credentials|invalid_credentials/i.test(error.message)) {
                throw new Error('Nieprawidłowa nazwa lub hasło');
            }
            if (/Email not confirmed/i.test(error.message)) {
                throw new Error('Konto nie potwierdzone — wyłącz "Confirm email" w Supabase Auth.');
            }
            if (/already.*signed|active.*session/i.test(error.message)) {
                step('Czyszczę poprzednią sesję...');
                await sb.auth.signOut({ scope: 'local' }).catch(() => {});
                const retry = await withRejectingTimeout(
                    sb.auth.signInWithPassword({ email: synth, password }),
                    8000, 'signInRetry'
                );
                if (retry.error) throw new Error(retry.error.message || 'Logowanie nieudane');
            } else {
                throw new Error(error.message || 'Logowanie nieudane');
            }
        }

        step('Pobieram profil...');
        await withRejectingTimeout(refreshCloudUser(), 5000, 'refreshCloudUser');
        if (cloudUser && cloudUser.profile) {
            user.name = cloudUser.profile.username;
            user.avatar = cloudUser.profile.avatar || user.avatar;
        } else {
            throw new Error('Zalogowano ale brak profilu (sprawdź czy migracja 0001 została zastosowana)');
        }
        return cloudUser;
    }

    /** Sign-out tylko z TEGO urzadzenia. Inne urzadzenia tego konta
        zostaja zalogowane. Po wylogowaniu tworzymy nowa anonimowa sesje
        zeby gra dalej dzialala bez przerwy. */
    async function cloudSignOut() {
        if (!cloudReady) return;
        try {
            await sb.auth.signOut({ scope: 'local' });
        } catch (_) {}
        try {
            await sb.auth.signInAnonymously();
            await refreshCloudUser();
        } catch (_) {}
    }

    /** Wyloguj ze WSZYSTKICH urzadzen (security feature). Uzywne gdy:
        - User obawia sie ze ktos przejal jego haslo
        - Zgubil telefon i chce odebrac dostep
        Po tym musi sie ponownie zalogowac wszedzie. */
    async function cloudSignOutEverywhere() {
        if (!cloudReady) return;
        try {
            await sb.auth.signOut({ scope: 'global' });
        } catch (_) {}
        try {
            await sb.auth.signInAnonymously();
            await refreshCloudUser();
        } catch (_) {}
    }

    /** Aktualizuje wskaznik chmury w UI. */
    function updateCloudStatusPill() {
        const pill = document.getElementById('cloud-status-pill');
        const label = document.getElementById('cloud-status-label');
        // Aktualizuj też welcome-hero mode pill
        updateConnectionMode();
        if (!pill || !label) return;
        pill.classList.remove('is-online', 'is-offline', 'is-error');
        if (!cloudReady) {
            pill.classList.add('is-offline');
            label.textContent = 'tylko lokalnie';
            pill.title = 'Brak połączenia z chmurą — wyniki tylko na tym urządzeniu';
            return;
        }
        if (cloudUser && cloudUser._persistent && cloudUser.profile) {
            pill.classList.add('is-online');
            label.textContent = `🌐 ${cloudUser.profile.username}`;
            pill.title = 'Zalogowany — wyniki synchronizują się ze wszystkimi urządzeniami';
            return;
        }
        // Anon w chmurze — wyniki idą do globalnego rankingu, ale tylko z tego urządzenia
        pill.classList.add('is-online');
        label.textContent = '🌐 anonimowo';
        pill.title = 'Zarejestruj konto aby grać na innych urządzeniach';
    }

    /* Aktualizuje wizualny wskaźnik trybu w welcome-hero (ring + pill).
       3 stany: online (persistent), anon (cloud bez konta), local (offline). */
    function updateConnectionMode() {
        const body = document.body;
        body.classList.remove('is-mode-online', 'is-mode-anon', 'is-mode-local');

        const text = document.getElementById('wh-mode-text');
        const action = document.getElementById('wh-mode-action');
        const pill = document.getElementById('wh-mode-pill');

        if (!cloudReady) {
            body.classList.add('is-mode-local');
            if (text) text.textContent = 'Tryb lokalny';
            if (action) action.textContent = 'Połącz ›';
            if (pill) pill.title = 'Wyniki zapisywane tylko na tym urządzeniu. Kliknij aby się zalogować i synchronizować.';
            return;
        }
        if (cloudUser && cloudUser._persistent && cloudUser.profile) {
            body.classList.add('is-mode-online');
            if (text) text.textContent = `Online · ${cloudUser.profile.username}`;
            if (action) action.textContent = 'Konto ›';
            if (pill) pill.title = 'Zalogowany — wyniki synchronizują się między urządzeniami. Kliknij aby zarządzać kontem.';
            return;
        }
        // Anonymous — w chmurze ale bez konta
        body.classList.add('is-mode-anon');
        if (text) text.textContent = 'Gość · bez konta';
        if (action) action.textContent = 'Zaloguj ›';
        if (pill) pill.title = 'Grasz jako gość — wyniki tylko z tego urządzenia. Zaloguj się aby synchronizować je między urządzeniami i zachować przy zmianie przeglądarki.';
    }

    const confettiColors = ["#0F766E", "#3730A3", "#D97706", "#0EA5E9", "#10B981", "#F59E0B"];
    const mathSymbols = ["+", "−", "×", "÷", "=", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "π", "√", "%"];

    /* ============================================================
       100 AWATAROW — 6 kategorii po ~17 emoji
       Dobor: zwierzeta lubiane przez dzieci, postacie fantasy, sport,
       sztuka i nauka, kosmos. Wszystko family-friendly, bez przemocy.
       Slowa kluczowe sluza wyszukiwarce. ============================================================ */
    const avatarLibrary = [
        { cat: 'Zwierzęta',    emoji: '🦉', kw: 'sowa madrosc' },
        { cat: 'Zwierzęta',    emoji: '🦁', kw: 'lew krol' },
        { cat: 'Zwierzęta',    emoji: '🐼', kw: 'panda' },
        { cat: 'Zwierzęta',    emoji: '🐱', kw: 'kot kotek' },
        { cat: 'Zwierzęta',    emoji: '🦊', kw: 'lis spryt' },
        { cat: 'Zwierzęta',    emoji: '🐸', kw: 'zaba' },
        { cat: 'Zwierzęta',    emoji: '🐯', kw: 'tygrys' },
        { cat: 'Zwierzęta',    emoji: '🐶', kw: 'pies piesek' },
        { cat: 'Zwierzęta',    emoji: '🐹', kw: 'chomik' },
        { cat: 'Zwierzęta',    emoji: '🐲', kw: 'smok dragon' },
        { cat: 'Zwierzęta',    emoji: '🐰', kw: 'krolik zajac' },
        { cat: 'Zwierzęta',    emoji: '🐻', kw: 'mis niedzwiedz' },
        { cat: 'Zwierzęta',    emoji: '🐨', kw: 'koala' },
        { cat: 'Zwierzęta',    emoji: '🦝', kw: 'szop' },
        { cat: 'Zwierzęta',    emoji: '🐮', kw: 'krowa' },
        { cat: 'Zwierzęta',    emoji: '🐷', kw: 'swinka' },
        { cat: 'Zwierzęta',    emoji: '🐭', kw: 'myszka mysz' },
        { cat: 'Zwierzęta',    emoji: '🦄', kw: 'jednorozec unicorn' },
        { cat: 'Zwierzęta',    emoji: '🐺', kw: 'wilk' },

        { cat: 'Morze i ptaki',emoji: '🐠', kw: 'rybka ryba' },
        { cat: 'Morze i ptaki',emoji: '🐳', kw: 'wieloryb' },
        { cat: 'Morze i ptaki',emoji: '🐬', kw: 'delfin' },
        { cat: 'Morze i ptaki',emoji: '🐙', kw: 'osmiornica' },
        { cat: 'Morze i ptaki',emoji: '🦑', kw: 'kalmar' },
        { cat: 'Morze i ptaki',emoji: '🦀', kw: 'krab' },
        { cat: 'Morze i ptaki',emoji: '🦈', kw: 'rekin' },
        { cat: 'Morze i ptaki',emoji: '🐧', kw: 'pingwin' },
        { cat: 'Morze i ptaki',emoji: '🐢', kw: 'zolw' },
        { cat: 'Morze i ptaki',emoji: '🐊', kw: 'krokodyl' },
        { cat: 'Morze i ptaki',emoji: '🦅', kw: 'orzel' },
        { cat: 'Morze i ptaki',emoji: '🦆', kw: 'kaczka' },
        { cat: 'Morze i ptaki',emoji: '🦜', kw: 'papuga' },
        { cat: 'Morze i ptaki',emoji: '🦋', kw: 'motyl' },
        { cat: 'Morze i ptaki',emoji: '🐝', kw: 'pszczola' },
        { cat: 'Morze i ptaki',emoji: '🐞', kw: 'biedronka' },

        { cat: 'Fantasy',      emoji: '👻', kw: 'duch' },
        { cat: 'Fantasy',      emoji: '🧙', kw: 'czarodziej mag' },
        { cat: 'Fantasy',      emoji: '🧚', kw: 'wrozka' },
        { cat: 'Fantasy',      emoji: '🧜', kw: 'syrena' },
        { cat: 'Fantasy',      emoji: '🧝', kw: 'elf' },
        { cat: 'Fantasy',      emoji: '🦸', kw: 'superbohater hero' },
        { cat: 'Fantasy',      emoji: '🥷', kw: 'ninja' },
        { cat: 'Fantasy',      emoji: '🤴', kw: 'ksiaze' },
        { cat: 'Fantasy',      emoji: '👸', kw: 'ksiezniczka' },
        { cat: 'Fantasy',      emoji: '🧞', kw: 'dzin' },
        { cat: 'Fantasy',      emoji: '🧌', kw: 'troll' },
        { cat: 'Fantasy',      emoji: '🦹', kw: 'lotr czarny charakter' },
        { cat: 'Fantasy',      emoji: '🤖', kw: 'robot' },
        { cat: 'Fantasy',      emoji: '👾', kw: 'kosmita potworek' },
        { cat: 'Fantasy',      emoji: '👽', kw: 'obcy alien' },

        { cat: 'Sport',        emoji: '⚽', kw: 'pilka nozna soccer' },
        { cat: 'Sport',        emoji: '🏀', kw: 'koszykowka' },
        { cat: 'Sport',        emoji: '🏈', kw: 'futbol amerykanski' },
        { cat: 'Sport',        emoji: '⚾', kw: 'baseball' },
        { cat: 'Sport',        emoji: '🎾', kw: 'tenis' },
        { cat: 'Sport',        emoji: '🏐', kw: 'siatkowka' },
        { cat: 'Sport',        emoji: '🏓', kw: 'ping pong' },
        { cat: 'Sport',        emoji: '🥋', kw: 'karate dojo' },
        { cat: 'Sport',        emoji: '🥊', kw: 'boks' },
        { cat: 'Sport',        emoji: '🚴', kw: 'rower' },
        { cat: 'Sport',        emoji: '🏊', kw: 'plywanie' },
        { cat: 'Sport',        emoji: '🏃', kw: 'bieg' },
        { cat: 'Sport',        emoji: '⛷️', kw: 'narty' },
        { cat: 'Sport',        emoji: '🏂', kw: 'snowboard' },
        { cat: 'Sport',        emoji: '🤸', kw: 'gimnastyka' },
        { cat: 'Sport',        emoji: '🧘', kw: 'joga' },

        { cat: 'Sztuka i nauka', emoji: '🎸', kw: 'gitara' },
        { cat: 'Sztuka i nauka', emoji: '🎹', kw: 'pianino' },
        { cat: 'Sztuka i nauka', emoji: '🎺', kw: 'trabka' },
        { cat: 'Sztuka i nauka', emoji: '🥁', kw: 'beben' },
        { cat: 'Sztuka i nauka', emoji: '🎤', kw: 'mikrofon' },
        { cat: 'Sztuka i nauka', emoji: '🎨', kw: 'paleta sztuka' },
        { cat: 'Sztuka i nauka', emoji: '🎭', kw: 'teatr' },
        { cat: 'Sztuka i nauka', emoji: '🎬', kw: 'film klaps' },
        { cat: 'Sztuka i nauka', emoji: '📚', kw: 'ksiazki' },
        { cat: 'Sztuka i nauka', emoji: '🔬', kw: 'mikroskop' },
        { cat: 'Sztuka i nauka', emoji: '🔭', kw: 'teleskop' },
        { cat: 'Sztuka i nauka', emoji: '🧮', kw: 'liczydlo' },
        { cat: 'Sztuka i nauka', emoji: '🧪', kw: 'probowka' },
        { cat: 'Sztuka i nauka', emoji: '🧬', kw: 'dna' },
        { cat: 'Sztuka i nauka', emoji: '🎲', kw: 'kostka' },
        { cat: 'Sztuka i nauka', emoji: '🧩', kw: 'puzzle' },
        { cat: 'Sztuka i nauka', emoji: '♟️', kw: 'szachy' },

        { cat: 'Symbole',      emoji: '🚀', kw: 'rakieta' },
        { cat: 'Symbole',      emoji: '⭐', kw: 'gwiazdka' },
        { cat: 'Symbole',      emoji: '🌟', kw: 'iskra' },
        { cat: 'Symbole',      emoji: '🌙', kw: 'ksiezyc' },
        { cat: 'Symbole',      emoji: '☀️', kw: 'slonce' },
        { cat: 'Symbole',      emoji: '🪐', kw: 'planeta' },
        { cat: 'Symbole',      emoji: '🌍', kw: 'ziemia' },
        { cat: 'Symbole',      emoji: '⚡', kw: 'piorun' },
        { cat: 'Symbole',      emoji: '🔥', kw: 'ogien' },
        { cat: 'Symbole',      emoji: '❄️', kw: 'sniezynka' },
        { cat: 'Symbole',      emoji: '🌈', kw: 'tecza' },
        { cat: 'Symbole',      emoji: '💎', kw: 'diament' },
        { cat: 'Symbole',      emoji: '👑', kw: 'korona' },
        { cat: 'Symbole',      emoji: '🏆', kw: 'puchar' },
        { cat: 'Symbole',      emoji: '🎯', kw: 'tarcza cel' },
        { cat: 'Symbole',      emoji: '🔮', kw: 'krysztalowa kula' },
        { cat: 'Symbole',      emoji: '🎁', kw: 'prezent' },
    ];

    // 30 pozytywnych cytatów po trafionej odpowiedzi.
    const cheers = [
        "Świetnie!",
        "Dasz radę!",
        "Tak trzymaj!",
        "Brawo!",
        "Kolejna trafiona!",
        "Mistrzowsko!",
        "Tak się to robi!",
        "Liczbowy talent!",
        "Genialnie!",
        "Tip-top!",
        "Trafnie!",
        "W punkt!",
        "Idealnie!",
        "Bingo!",
        "Nie do zatrzymania!",
        "Mózg pracuje!",
        "Czujesz to!",
        "Pokazujesz klasę!",
        "Tempo wzorowe!",
        "Pełen luz!",
        "Niezły refleks!",
        "Tak właśnie!",
        "Krok po kroku do mistrza!",
        "Robisz to świetnie!",
        "Liczby Cię słuchają!",
        "Kosmos!",
        "Jesteś w gazie!",
        "To była pestka!",
        "Ekstra!",
        "Cudo!"
    ];

    // 30 wspierających cytatów po nietrafionej.
    const consolations = [
        "Nic się nie stało!",
        "Spokojnie, jeszcze potrenujemy.",
        "Każdy popełnia błędy.",
        "Następna będzie Twoja!",
        "Spróbuj jeszcze raz!",
        "Bez paniki!",
        "Już wiesz na co uważać.",
        "Trzymaj głowę wysoko!",
        "Pomyłka to lekcja.",
        "Hej, bywa!",
        "To nic strasznego.",
        "Krok do tyłu, dwa do przodu!",
        "Teraz wiesz lepiej.",
        "Dalej, do dzieła!",
        "Skup się i lecimy!",
        "Nowa szansa już idzie!",
        "Każdy mistrz się myli.",
        "Wytrzymaj, idziesz dobrze!",
        "Małe potknięcie, nie problem.",
        "Spokojnie, oddech.",
        "Wracamy do gry!",
        "Liczby bywają podchwytliwe.",
        "Odetchnij i spróbuj!",
        "Mózg się rozgrzewa.",
        "Powolutku, ale dokładnie.",
        "Nie poddawaj się!",
        "Każda gra to trening.",
        "Zaraz znów trafisz!",
        "Nawet Einstein się mylił.",
        "Trening czyni mistrza."
    ];

    // Tracker ostatnich uzytych — nie powtarzaj w sesji.
    const recentQuotes = { cheer: [], console: [] };

    function getQuote(type) {
        const pool = type === 'cheer' ? cheers : consolations;
        const recent = recentQuotes[type === 'cheer' ? 'cheer' : 'console'];
        const memory = Math.min(Math.floor(pool.length * 0.6), pool.length - 1);
        let candidate;
        let attempts = 0;
        do {
            candidate = pool[Math.floor(Math.random() * pool.length)];
            attempts++;
        } while (recent.includes(candidate) && attempts < 30);
        recent.push(candidate);
        if (recent.length > memory) recent.shift();
        return candidate;
    }

    // Math facts shown on profile screen, rotating every 7s.
    const mathFacts = [
        "Liczba π ma nieskończenie wiele cyfr po przecinku - dziś znamy ich już ponad 100 bilionów.",
        "0! (silnia z zera) wynosi 1 - to konwencja, która ratuje wiele wzorów.",
        "Suma kątów w każdym trójkącie wynosi dokładnie 180°.",
        "Liczba 1 nie jest liczbą pierwszą, choć dzieli się tylko przez siebie.",
        "Dzielenie przez zero jest niezdefiniowane - matematyka po prostu się buntuje.",
        "Każda liczba podniesiona do potęgi 0 daje 1. Nawet π⁰ = 1.",
        "Najmniejsza liczba pierwsza to 2 - i jednocześnie jedyna parzysta.",
        "Suma cyfr każdej wielokrotności 9 jest podzielna przez 9 (np. 27 → 2+7=9).",
        "Liczba ujemna razy ujemna daje dodatnią - dwa minusy znoszą się.",
        "Liczba Eulera e ≈ 2,71828 jest podstawą wzrostu wykładniczego.",
        "Złoty podział φ ≈ 1,618 pojawia się w sztuce, naturze i architekturze.",
        "Mnożenie to skrócone dodawanie. Potęgowanie to skrócone mnożenie.",
        "100 to liczba kwadratowa: 10 × 10 = 100. A 1000 to sześcian: 10³.",
        "Liczby pierwsze są nieskończone - udowodnił to Euklides 2300 lat temu.",
        "Twierdzenie Pitagorasa: w trójkącie prostokątnym a² + b² = c².",
        "Cyfry 142857 to 'magiczna' liczba - mnożenie ×2 daje 285714, ×3 daje 428571."
    ];

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    // KLUCZOWE na iOS: NIE tworzymy AudioContext przy ladowaniu skryptu —
    // iOS WebKit produkuje wtedy "uszkodzony" context ktorego resume() nigdy
    // nie odpala oscillatorow. Tworzymy lazy w ensureAudioCtx() dopiero na
    // pierwsze user-gesture.
    let audioCtx = null;
    let audioCtxFailed = false;

    /* ---------- Stan ---------- */
    let user = { name: "Gracz", avatar: "🦉" };
    let settings = { diff: "easy", timeMin: 3, mode: "add" };
    let gameState = { score: 0, history: [], timerInterval: null, endTime: 0, active: false, combo: 0 };

    /* ============================================================
       BACKGROUND EFFECTS
       ============================================================ */
    function initBackgroundSymbols() {
        const layer = document.querySelector('.math-bg');
        if (!layer) return;
        const count = window.innerWidth < 700 ? 14 : 22;
        for (let i = 0; i < count; i++) {
            const span = document.createElement('span');
            span.textContent = mathSymbols[Math.floor(Math.random() * mathSymbols.length)];
            const size = 28 + Math.random() * 64;
            const startX = Math.random() * 100;
            const driftX = (Math.random() - 0.5) * 40;
            const duration = 22 + Math.random() * 24;
            const delay = -Math.random() * duration;
            const rotation = Math.random() * 60 - 30;
            span.style.fontSize = `${size}px`;
            span.style.left = `${startX}vw`;
            span.style.top = `${100 + Math.random() * 20}vh`;
            span.style.setProperty('--dx', `${driftX}vw`);
            span.style.setProperty('--dy', `-${110 + Math.random() * 30}vh`);
            span.style.setProperty('--rot', `${rotation}deg`);
            span.style.animationDuration = `${duration}s`;
            span.style.animationDelay = `${delay}s`;
            span.style.color = `hsla(${Math.random() * 60 + 250}, 90%, 80%, ${0.35 + Math.random() * 0.45})`;
            layer.appendChild(span);
        }
    }

    function initParticles() {
        const layer = document.querySelector('.particles');
        if (!layer) return;
        const count = window.innerWidth < 700 ? 24 : 40;
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('div');
            dot.className = 'particle-dot';
            dot.style.left = `${Math.random() * 100}vw`;
            dot.style.top = `${Math.random() * 100}vh`;
            dot.style.animationDelay = `${Math.random() * 3}s`;
            dot.style.animationDuration = `${2 + Math.random() * 3}s`;
            dot.style.opacity = `${0.4 + Math.random() * 0.6}`;
            const size = 3 + Math.random() * 5;
            dot.style.width = `${size}px`;
            dot.style.height = `${size}px`;
            layer.appendChild(dot);
        }
    }

    /* ---------- Parallax hero (mouse + tilt) ---------- */
    function initHeroParallax() {
        // Skip on touch devices / no fine pointer — avoids visual artifacts
        // and pointless work on phones/tablets.
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        const scene = document.querySelector('.hero-math-scene');
        if (!scene) return;
        let raf = null;
        let targetX = 0, targetY = 0, currentX = 0, currentY = 0;

        const onMove = (e) => {
            const rect = scene.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            targetX = (e.clientX - cx) / rect.width;
            targetY = (e.clientY - cy) / rect.height;
            if (!raf) animate();
        };

        const animate = () => {
            currentX += (targetX - currentX) * 0.08;
            currentY += (targetY - currentY) * 0.08;
            scene.style.transform = `rotateY(${currentX * 8}deg) rotateX(${-currentY * 8}deg)`;

            const tokens = scene.querySelectorAll('.math-token');
            tokens.forEach((t, idx) => {
                const depth = 1 + (idx % 4) * 0.35;
                t.style.transform += ` translate3d(${currentX * 12 * depth}px, ${currentY * 12 * depth}px, 0)`;
            });

            const formulas = scene.querySelectorAll('.math-formula');
            formulas.forEach((f, idx) => {
                const depth = 1 + (idx % 4) * 0.45;
                f.style.transform += ` translate3d(${currentX * 16 * depth}px, ${currentY * 16 * depth}px, 0)`;
            });

            if (Math.abs(currentX - targetX) > 0.001 || Math.abs(currentY - targetY) > 0.001) {
                raf = requestAnimationFrame(animate);
            } else {
                raf = null;
            }
        };

        document.addEventListener('mousemove', onMove);
    }

    /* ============================================================
       AUDIO — z dwiema sciezkami (WebAudio + HTML5 Audio fallback)
       ============================================================
       iOS WebKit ma kilka quirkow ktore zlamaly poprzednie podejscia:
       1) AudioContext stworzony przed user-gesture jest "broken"
       2) resume() musi byc wywolany Z user-gesture
       3) Hardware mute switch na iPhone moze wyciszyc Web Audio
       4) Niektore wersje iOS maja bugi z OscillatorNode
       Dlatego trzymamy DWIE sciezki: WebAudio (lazy) jako preferowana,
       i HTML5 <audio> z syntezowanymi WAV jako fallback. Plus retry
       jezeli pierwsza nie zagra w 100ms. */

    /* ---- HTML5 Audio fallback: synteza WAV w pamieci ---- */
    function makeWav(samples, sampleRate) {
        sampleRate = sampleRate || 22050;
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);          // PCM
        view.setUint16(22, 1, true);          // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, samples.length * 2, true);
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
        return buffer;
    }

    function bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    function buildSoundDataUri(type) {
        const sr = 22050;
        const dur = type === 'lvl' ? 0.45 : 0.30;
        const len = Math.floor(dur * sr);
        const data = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            const env = Math.exp(-3.5 * t / dur);
            let v;
            if (type === 'c') {
                // up-chirp 500 -> 1000 Hz, sine
                const f = 500 + (1000 - 500) * (t / dur);
                v = Math.sin(2 * Math.PI * f * t) * 0.7;
            } else if (type === 'w') {
                // down-chirp 150 -> 100 Hz, sawtooth-ish
                const f = 150 - (150 - 100) * (t / dur);
                const phase = (f * t) % 1;
                v = (2 * phase - 1) * 0.55;
            } else { // lvl
                // 3-step ascending triangle 420/620/840
                const f = t < 0.15 ? 420 : (t < 0.30 ? 620 : 840);
                const tri = 2 * Math.abs(2 * ((f * t) % 1) - 1) - 1;
                v = tri * 0.55;
            }
            data[i] = v * env;
        }
        return 'data:audio/wav;base64,' + bufferToBase64(makeWav(data, sr));
    }

    /** Mapa typ -> static <audio> id w HTML.
        c=correct, w=wrong, bip=10s countdown, click=mission button,
        hover=mission button cursor over, lvl=reward (uses correct sample). */
    const audioTagIds = {
        c: 'snd-c', w: 'snd-w', bip: 'snd-bip',
        click: 'snd-click', hover: 'snd-hover', lvl: 'snd-lvl',
    };

    let html5Audios = null;
    function getHtml5Audio(type) {
        if (!html5Audios) html5Audios = {};
        if (html5Audios[type]) return html5Audios[type];

        // 1) Prefer static <audio> tag z HTML (juz ma src=sound/xxx).
        const tagId = audioTagIds[type] || ('snd-' + type);
        const staticEl = document.getElementById(tagId);
        if (staticEl) {
            staticEl.preload = 'auto';
            staticEl.playsInline = true;
            staticEl.setAttribute('playsinline', '');
            staticEl.setAttribute('webkit-playsinline', '');
            // Glosnosc per typ — bip ciszej zeby nie meczyl, hover bardzo cicho
            staticEl.volume = (type === 'hover' ? 0.35 :
                               type === 'bip'   ? 0.65 :
                               type === 'click' ? 0.7  : 0.9);
            try { staticEl.load(); } catch(_) {}
            html5Audios[type] = staticEl;
            return staticEl;
        }

        // 2) Fallback: syntezowany WAV (tylko dla c/w/lvl — pozostale type'y
        //    zwroca null jezeli static tag nie istnieje).
        if (type === 'c' || type === 'w' || type === 'lvl') {
            const a = new Audio(buildSoundDataUri(type));
            a.preload = 'auto';
            a.playsInline = true;
            a.volume = 0.85;
            try { a.load(); } catch(_) {}
            html5Audios[type] = a;
            return a;
        }
        return null;
    }

    /* ---- WebAudio (preferred) — uzywamy AudioBufferSourceNode zamiast
         OscillatorNode bo Oscillator jest zawodny na iOS. Bufor PCM jest
         generowany raz w pamieci z Float32Array i odtwarzany z gainem. ---- */
    function ensureAudioCtx() {
        if (audioCtx) return audioCtx;
        if (audioCtxFailed) return null;
        if (!AudioContextCtor) { audioCtxFailed = true; return null; }
        try {
            audioCtx = new AudioContextCtor();
            return audioCtx;
        } catch (e) {
            audioCtxFailed = true;
            return null;
        }
    }

    function buildPcmSamples(type, sampleRate) {
        const dur = type === 'lvl' ? 0.45 : 0.30;
        const len = Math.floor(dur * sampleRate);
        const data = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            const t = i / sampleRate;
            const env = Math.exp(-3.5 * t / dur);
            let v;
            if (type === 'c') {
                const f = 500 + (1000 - 500) * (t / dur);
                v = Math.sin(2 * Math.PI * f * t) * 0.85;
            } else if (type === 'w') {
                const f = 150 - (150 - 100) * (t / dur);
                const phase = (f * t) % 1;
                v = (2 * phase - 1) * 0.7;
            } else { // lvl
                const f = t < 0.15 ? 420 : (t < 0.30 ? 620 : 840);
                const tri = 2 * Math.abs(2 * ((f * t) % 1) - 1) - 1;
                v = tri * 0.7;
            }
            data[i] = v * env;
        }
        return data;
    }

    let audioBuffers = null;
    function getAudioBuffer(ctx, type) {
        if (!audioBuffers) audioBuffers = {};
        if (audioBuffers[type]) return audioBuffers[type];
        const sr = ctx.sampleRate || 44100;
        const samples = buildPcmSamples(type, sr);
        const buf = ctx.createBuffer(1, samples.length, sr);
        buf.getChannelData(0).set(samples);
        audioBuffers[type] = buf;
        return buf;
    }

    function playWebAudio(ctx, type) {
        const buf = getAudioBuffer(ctx, type);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0.9;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0);
        // ping diagnostic indicator
        flashAudioIndicator(true);
    }

    function playHtml5(type) {
        const a = getHtml5Audio(type);
        if (!a) return;
        try {
            a.currentTime = 0;
            const p = a.play();
            if (p && p.catch) p.catch(() => flashAudioIndicator(false));
            else flashAudioIndicator(true);
        } catch (_) {
            flashAudioIndicator(false);
        }
    }

    /** Maly indicator audio status w prawym gornym rogu game screen.
        Zielony = audio zagralo, czerwony = problem (mute switch?). */
    function flashAudioIndicator(ok) {
        const el = document.getElementById('audio-indicator');
        if (!el) return;
        el.classList.remove('audio-good', 'audio-bad');
        void el.offsetWidth;
        el.classList.add(ok ? 'audio-good' : 'audio-bad');
    }

    function isIOSDevice() {
        const ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function getAudioDiagnostics() {
        const lines = [];
        lines.push('AudioContext: ' + (AudioContextCtor ? 'dostępny' : 'BRAK'));
        lines.push('Stan kontekstu: ' + (audioCtx ? audioCtx.state : 'nie utworzono'));
        lines.push('Sample rate: ' + (audioCtx ? audioCtx.sampleRate + ' Hz' : '—'));
        lines.push('Bufory PCM: ' + (audioBuffers ? Object.keys(audioBuffers).length + ' / 3' : '0 / 3'));
        lines.push('HTML5 Audio: ' + (html5Audios ? 'OK' : 'nie zainicjalizowano'));
        lines.push('Platforma: ' + (isIOSDevice() ? 'iOS (sprawdź silent switch!)' : navigator.platform));
        lines.push('User-Agent: ' + (navigator.userAgent || '?').substring(0, 80));
        return lines.join('\n');
    }

    /* ---- Settings modal handlers ---- */
    function showSettings() {
        const modal = document.getElementById('modal-settings');
        if (!modal) return;
        // Pokaz iOS hint tylko na iOS
        const hint = document.getElementById('ios-audio-hint');
        if (hint) hint.style.display = isIOSDevice() ? 'block' : 'none';
        // Wyczysc statusy
        const audioStatus = document.getElementById('settings-audio-status');
        const clearStatus = document.getElementById('settings-clear-status');
        if (audioStatus) {
            audioStatus.textContent = 'Naciśnij przycisk aby przetestować';
            audioStatus.classList.remove('is-good', 'is-bad');
        }
        if (clearStatus) clearStatus.textContent = '';
        modal.style.display = 'flex';
    }

    function closeSettings() {
        const modal = document.getElementById('modal-settings');
        if (modal) modal.style.display = 'none';
    }

    function settingsTestSound() {
        const status = document.getElementById('settings-audio-status');
        const diag = document.getElementById('audio-diag');
        if (status) {
            status.textContent = 'Testowanie...';
            status.classList.remove('is-good', 'is-bad');
        }
        playSound('c');
        // Po krotkim opoznieniu odczytaj wynik z indicator
        setTimeout(() => {
            const ind = document.getElementById('audio-indicator');
            const isGood = ind && ind.classList.contains('audio-good');
            if (status) {
                if (isGood) {
                    status.textContent = '✓ Audio gotowe (jeśli nie słyszysz — sprawdź silent switch)';
                    status.classList.add('is-good');
                } else {
                    status.textContent = '⚠ Audio zablokowane — szczegóły poniżej';
                    status.classList.add('is-bad');
                }
            }
            if (diag) {
                diag.textContent = getAudioDiagnostics();
                diag.classList.add('is-shown');
            }
        }, 200);
    }

    /* ---- ACCOUNT modal ---- */
    function showAccount() {
        const modal = document.getElementById('modal-account');
        if (!modal) return;

        // Wyczysc statusy
        ['acc-signup-status', 'acc-signin-status'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = ''; el.className = 'acc-status'; }
        });

        // Prefill nazwy: profile input → user.name → loadLastUser → puste
        // Cel: jeśli grasz lokalnie pod jakąś nazwą, formularz ją podstawia
        // i jednym kliknięciem rezerwujesz tę nazwę w chmurze.
        const nameInput = document.getElementById('acc-signup-name');
        const signinNameInput = document.getElementById('acc-signin-name');
        if (nameInput) {
            const profileInput = document.getElementById('username');
            const last = loadLastUser();
            const localName =
                (profileInput && profileInput.value && profileInput.value.trim()) ||
                (user && user.name && user.name !== 'Gracz' ? user.name : '') ||
                (last && last.name) ||
                '';
            if (localName && !nameInput.value) nameInput.value = localName;
            if (signinNameInput && localName && !signinNameInput.value) signinNameInput.value = localName;
        }

        renderAccountModal();
        modal.style.display = 'flex';
    }

    /* Reactive — przełącza widok modalu zależnie od stanu konta:
       online (zalogowany trwale) | anon (cloud bez konta) | local (offline). */
    function renderAccountModal() {
        const modal = document.getElementById('modal-account');
        if (!modal || modal.style.display === 'none') return;

        const titleEl = document.getElementById('acc-modal-title');
        const subtitleEl = document.getElementById('acc-modal-subtitle');
        const views = ['online', 'anon', 'local'];

        let activeView, title, subtitle;
        if (cloudReady && cloudUser && cloudUser._persistent && cloudUser.profile) {
            activeView = 'online';
            title = 'Twoje konto';
            subtitle = `Zalogowany jako ${cloudUser.profile.username}`;
        } else if (cloudReady) {
            activeView = 'anon';
            title = 'Konto';
            subtitle = 'Zaloguj się aby synchronizować wyniki między urządzeniami';
        } else {
            activeView = 'local';
            title = 'Tryb lokalny';
            subtitle = 'Brak połączenia z chmurą';
        }

        if (titleEl) titleEl.textContent = title;
        if (subtitleEl) subtitleEl.textContent = subtitle;

        views.forEach(v => {
            const el = document.getElementById('acc-view-' + v);
            if (el) el.style.display = (v === activeView ? 'flex' : 'none');
        });

        // Zresetuj logout confirmation jeśli przełączamy widoki
        const confirmBox = document.getElementById('acc-logout-confirm');
        const buttons = document.getElementById('acc-logout-buttons');
        if (confirmBox) confirmBox.style.display = 'none';
        if (buttons) buttons.style.display = 'flex';

        if (activeView === 'online') populateAccountOnlineView();
        if (activeView === 'anon') accountTab('signin'); // Domyślnie LOGIN — większość wracających ma już konto
    }

    function populateAccountOnlineView() {
        const profile = cloudUser && cloudUser.profile;
        if (!profile) return;
        const set = (id, val, def) => {
            const el = document.getElementById(id);
            if (!el) return;
            const has = !!(val && String(val).trim());
            el.textContent = has ? val : (def || 'Nie ustawiono');
            el.classList.toggle('is-empty', !has);
        };
        const av = document.getElementById('acc-online-avatar');
        if (av) av.textContent = profile.avatar || '🦉';
        const name = document.getElementById('acc-online-name');
        if (name) name.textContent = profile.username || '—';
        set('acc-pi-school', profile.school);
        set('acc-pi-class', profile.class_name);
        set('acc-pi-city', profile.city);
        set('acc-pi-journal', profile.journal_no);
    }

    /* ===== Logout flow — inline confirmation, reaktywne ===== */
    let pendingLogoutScope = null; // 'local' | 'global'

    function askLogoutLocal() { showLogoutConfirm('local'); }
    function askLogoutGlobal() { showLogoutConfirm('global'); }

    function showLogoutConfirm(scope) {
        pendingLogoutScope = scope;
        const buttons = document.getElementById('acc-logout-buttons');
        const confirmBox = document.getElementById('acc-logout-confirm');
        const msg = document.getElementById('acc-logout-confirm-msg');
        if (buttons) buttons.style.display = 'none';
        if (confirmBox) confirmBox.style.display = 'flex';
        if (msg) {
            msg.textContent = scope === 'global'
                ? '🌍 Wyloguj ze wszystkich urządzeń? Każde urządzenie będzie musiało zalogować się na nowo.'
                : '🚪 Wylogować z tego urządzenia? Inne urządzenia (telefon, komputer, tablet) pozostaną zalogowane.';
        }
    }

    function cancelLogout() {
        pendingLogoutScope = null;
        const buttons = document.getElementById('acc-logout-buttons');
        const confirmBox = document.getElementById('acc-logout-confirm');
        if (buttons) buttons.style.display = 'flex';
        if (confirmBox) confirmBox.style.display = 'none';
    }

    async function doLogoutConfirmed() {
        const scope = pendingLogoutScope;
        pendingLogoutScope = null;

        // Loading state na przycisku
        const btn = document.querySelector('[data-action="doLogoutConfirmed"]');
        const cancelBtn = document.querySelector('[data-action="cancelLogout"]');
        const origText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Wylogowuję...'; }
        if (cancelBtn) cancelBtn.disabled = true;

        // Safety timeout — jeśli cloudSignOut zawiesi się dłużej niż 6s,
        // wymuszamy reload (lokalny stan i tak się odświeży)
        const timeoutId = setTimeout(() => {
            try { closeAccount(); } catch (_) {}
            location.reload();
        }, 6000);

        try {
            if (scope === 'global') {
                await cloudSignOutEverywhere();
            } else {
                await cloudSignOut();
            }
            clearTimeout(timeoutId);
            // Wyczyść "ostatni gracz" — po wylogowaniu pokażemy ekran wyboru gracza
            try { localStorage.removeItem(lastUserKey); } catch (_) {}
            closeAccount();
            setTimeout(() => location.reload(), 200);
        } catch (e) {
            clearTimeout(timeoutId);
            console.error('[logout] failed:', e);
            showAccToast('⚠ Nie udało się wylogować: ' + (e.message || ''), 'bad');
            cancelLogout();
            if (btn) { btn.disabled = false; btn.textContent = origText; }
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }

    function showAccToast(text, kind) {
        const toast = document.getElementById('acc-toast');
        if (!toast) return;
        toast.textContent = text;
        toast.className = 'acc-toast' + (kind ? ' is-' + kind : '');
        toast.style.display = 'block';
        clearTimeout(showAccToast._t);
        showAccToast._t = setTimeout(() => {
            toast.style.display = 'none';
        }, 3500);
    }

    function reloadPage() {
        window.location.reload();
    }

    function closeAccount() {
        const modal = document.getElementById('modal-account');
        if (modal) modal.style.display = 'none';
    }

    function accountTab(name) {
        document.querySelectorAll('#modal-account .tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        ['signup', 'signin'].forEach(t => {
            const el = document.getElementById('acc-tab-' + t);
            if (el) el.style.display = (t === name ? 'flex' : 'none');
        });
    }

    function setAccStatus(id, text, kind) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.className = 'acc-status is-shown' + (kind ? ` is-${kind}` : '');
    }

    function accountSuggestName() {
        const name = generateRandomName();
        const input = document.getElementById('acc-signup-name');
        if (input) {
            input.value = name;
            input.focus();
        }
    }

    async function accountSignUp() {
        if (accountSignUp._busy) return;
        const name = (document.getElementById('acc-signup-name').value || '').trim();
        const pass = document.getElementById('acc-signup-pass').value || '';
        const email = (document.getElementById('acc-signup-email').value || '').trim();
        const usernameOk = /^[A-Za-z0-9_-]{2,20}$/.test(name);

        if (!usernameOk) {
            setAccStatus('acc-signup-status', 'Nazwa: 2-20 znaków, tylko litery, cyfry, _ i -', 'bad');
            return;
        }
        if (pass.length < 6) {
            setAccStatus('acc-signup-status', 'Hasło musi mieć minimum 6 znaków', 'bad');
            return;
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setAccStatus('acc-signup-status', 'Nieprawidłowy format e-maila', 'bad');
            return;
        }

        const submitBtn = document.querySelector('[data-action="accountSignUp"]');
        const originalText = submitBtn ? submitBtn.textContent : '';
        accountSignUp._busy = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ Tworzę konto...';
        }

        try {
            await cloudSignUp(name, pass, email, (text) => {
                setAccStatus('acc-signup-status', '⏳ ' + text, 'info');
            });
            user.name = name;
            const profileInput = document.getElementById('username');
            if (profileInput) profileInput.value = name;
            saveLastUser();
            renderWelcomeBack();
            updateCloudStatusPill();
            setAccStatus('acc-signup-status', `✓ Konto utworzone! Witaj, ${name}.`, 'good');
            // Przełącz modal na online view zamiast zamykać — user widzi że jest zalogowany
            setTimeout(() => {
                renderAccountModal();
                showAccToast(`✓ Konto utworzone — zalogowano jako ${name}`, 'good');
            }, 800);
        } catch (e) {
            console.error('[signup] failed:', e);
            setAccStatus('acc-signup-status', '⚠ ' + (e.message || 'Nie udało się stworzyć konta'), 'bad');
        } finally {
            accountSignUp._busy = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
        }
    }

    async function accountSignIn() {
        const name = (document.getElementById('acc-signin-name').value || '').trim();
        const pass = document.getElementById('acc-signin-pass').value || '';

        if (!name || !pass) {
            setAccStatus('acc-signin-status', 'Podaj nazwę i hasło', 'bad');
            return;
        }

        try {
            await cloudSignIn(name, pass, (text) => {
                setAccStatus('acc-signin-status', '⏳ ' + text, 'info');
            });
            // Zaktualizuj formularz profilu
            const profileInput = document.getElementById('username');
            if (profileInput) profileInput.value = user.name;
            document.querySelectorAll('.avatar-option').forEach(el =>
                el.classList.toggle('selected', el.textContent.trim() === user.avatar)
            );
            saveLastUser();
            renderWelcomeBack();
            renderProfileTopList();
            updateCloudStatusPill();
            setAccStatus('acc-signin-status', `✓ Witaj z powrotem, ${user.name}!`, 'good');
            // Po krótkim sukcesie — przełącz modal na online view (zamiast zamykać)
            setTimeout(() => {
                renderAccountModal();
                showAccToast(`✓ Zalogowano jako ${user.name}`, 'good');
            }, 800);
        } catch (e) {
            setAccStatus('acc-signin-status', '⚠ ' + (e.message || 'Logowanie nieudane'), 'bad');
        }
    }

    function accountSignOut() {
        showAlert(
            'Wylogować się na TYM urządzeniu?',
            'Inne urządzenia (telefon, komputer, tablet) na których jesteś zalogowany — pozostaną zalogowane.',
            '👋',
            async () => {
                try {
                    await cloudSignOut();
                    updateCloudStatusPill();
                    renderWelcomeBack();
                    closeAccount();
                } catch (e) {
                    showAlert('Błąd wylogowania', e.message || 'Spróbuj ponownie', '⚠️', null);
                }
            }
        );
    }

    function accountSignOutEverywhere() {
        showAlert(
            'Wylogować ze WSZYSTKICH urządzeń?',
            'Użyj tej opcji jeżeli zgubiłeś telefon, ktoś poznał Twoje hasło, albo chcesz odzyskać kontrolę nad kontem. Każde urządzenie będzie musiało zalogować się na nowo.',
            '🔒',
            async () => {
                try {
                    await cloudSignOutEverywhere();
                    updateCloudStatusPill();
                    renderWelcomeBack();
                    closeAccount();
                    showAlert(
                        'Wylogowano wszędzie',
                        'Wszystkie sesje (włącznie z tym urządzeniem) zostały zakończone.',
                        '✓',
                        null
                    );
                } catch (e) {
                    showAlert('Błąd wylogowania', e.message || 'Spróbuj ponownie', '⚠️', null);
                }
            }
        );
    }

    function settingsClearData() {
        showAlert(
            'Wyczyścić wszystkie dane?',
            'Usuniemy wyniki i zapamiętany profil z tego urządzenia. Konta w chmurze (jeśli istnieją) NIE są usuwane — tylko lokalna kopia.',
            '🗑️',
            () => {
                const status = document.getElementById('settings-clear-status');
                try {
                    localStorage.removeItem(storageKey);
                    localStorage.removeItem(legacyStorageKey);
                    localStorage.removeItem(lastUserKey);
                    if (status) {
                        status.textContent = '✓ Wszystkie dane usunięte';
                        status.classList.add('is-good');
                    }
                    renderProfileTopList();
                    renderWelcomeBack();
                } catch (e) {
                    if (status) {
                        status.textContent = '⚠ Błąd: ' + (e.message || '');
                        status.classList.add('is-bad');
                    }
                }
            }
        );
    }

    /** Glowny entry. Strategia:
        - Type 'bip' / 'click' / 'hover': zawsze HTML5 z prawdziwymi plikami
          (krotkie probki nagrane, nie da sie zsyntezowac sensownie)
        - Type 'c' / 'w' / 'lvl': mamy prawdziwy plik W static tag,
          ALE na desktop/Android probujemy najpierw WebAudio (z PCM
          syntez ktory mamy w buforach) bo daje precyzyjna kontrole;
          jezeli static tag istnieje uzywamy go zamiast PCM —
          prawdziwy nagrany dzwiek brzmi lepiej. */
    function playSound(type) {
        if (type === 'bip' || type === 'click' || type === 'hover') {
            playHtml5(type);
            return;
        }

        const ios = isIOSDevice();
        // Na iOS lub gdy mamy prawdziwy plik dzwiekowy — uzyj HTML5.
        const hasStaticFile = !!document.getElementById(audioTagIds[type]);
        if (ios || hasStaticFile) {
            playHtml5(type);
        }

        // Na desktop dodatkowo WebAudio (jezeli nie mamy pliku) jako PCM synth.
        if (hasStaticFile) return;
        const ctx = ensureAudioCtx();
        if (!ctx) {
            if (!ios) playHtml5(type);
            return;
        }
        const tryWebAudio = () => {
            try { playWebAudio(ctx, type); }
            catch (e) { if (!ios) playHtml5(type); }
        };
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => {
                if (ctx.state === 'running') tryWebAudio();
                else if (!ios) playHtml5(type);
            }).catch(() => { if (!ios) playHtml5(type); });
        } else {
            tryWebAudio();
        }
    }

    /** Przy pierwszym user-gesture: tworzymy ctx, resume, silent warm-up,
        plus dotykamy HTML5 audio elements (load) zeby iOS pozwolil na play. */
    function installAudioUnlockGestureHooks() {
        let installed = false;
        const handler = () => {
            const ctx = ensureAudioCtx();
            if (ctx && ctx.state === 'suspended') {
                ctx.resume().then(() => {
                    try {
                        const buffer = ctx.createBuffer(1, 1, 22050);
                        const src = ctx.createBufferSource();
                        src.buffer = buffer;
                        src.connect(ctx.destination);
                        src.start(0);
                    } catch (_) {}
                }).catch(() => {});
            }
            // "Touch" wszystkie HTML5 audio w user-gesture context — iOS to zapamietuje
            // i pozwoli pozniej odtwarzac bez kolejnego user-gesture.
            const types = ['c','w','lvl','bip','click','hover'];
            types.forEach(k => getHtml5Audio(k));
            types.forEach(k => {
                const a = html5Audios && html5Audios[k];
                if (!a) return;
                try {
                    a.muted = true;
                    const p = a.play();
                    if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
                    else { a.pause(); a.currentTime = 0; a.muted = false; }
                } catch (_) {}
            });
            if (!installed) {
                installed = true;
            }
        };
        const events = ['touchstart','touchend','mousedown','click','keydown'];
        events.forEach(evt => document.addEventListener(evt, handler, { passive: true, once: false }));
        // Auto-cleanup po pierwszym sukcesie
        let cleanup = null;
        cleanup = () => {
            if (audioCtx && audioCtx.state === 'running') {
                events.forEach(evt => document.removeEventListener(evt, handler));
            } else {
                setTimeout(cleanup, 500);
            }
        };
        setTimeout(cleanup, 1000);
    }

    /* ============================================================
       FX (visual effects)
       ============================================================ */
    function confettiBurst(originEl) {
        const rect = (originEl || document.body).getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const burst = document.createElement('div');
        burst.className = 'confetti-burst';
        burst.style.left = `${x}px`;
        burst.style.top = `${y}px`;

        const pieces = 28;
        for (let i = 0; i < pieces; i++) {
            const p = document.createElement('div');
            p.className = 'confetti-piece';
            const angle = (Math.PI * 2 * i) / pieces + (Math.random() - 0.5) * 0.6;
            const dist = 120 + Math.random() * 180;
            const cx = Math.cos(angle) * dist;
            const cy = Math.sin(angle) * dist + Math.random() * 100;
            p.style.background = confettiColors[Math.floor(Math.random() * confettiColors.length)];
            p.style.setProperty('--cx', `${cx}px`);
            p.style.setProperty('--cy', `${cy}px`);
            p.style.setProperty('--cr', `${Math.random() * 1080 - 540}deg`);
            p.style.animationDelay = `${Math.random() * 0.1}s`;
            p.style.animationDuration = `${1.0 + Math.random() * 0.8}s`;
            if (Math.random() > 0.5) {
                p.style.borderRadius = '50%';
                p.style.width = '8px';
                p.style.height = '8px';
            }
            burst.appendChild(p);
        }
        document.body.appendChild(burst);
        setTimeout(() => burst.remove(), 2000);
    }

    function screenShake() {
        const c = document.querySelector('.game-container');
        if (!c) return;
        c.classList.remove('screen-shake');
        // Force reflow so animation restarts
        void c.offsetWidth;
        c.classList.add('screen-shake');
        setTimeout(() => c.classList.remove('screen-shake'), 600);
    }

    function flashOverlay(kind) {
        const el = document.createElement('div');
        el.className = kind === 'good' ? 'flash-good' : 'flash-bad';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 600);
    }

    function bumpScoreEl() {
        const el = document.getElementById('game-score');
        if (!el) return;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
    }

    function animateScoreTo(targetValue) {
        const el = document.getElementById('game-score');
        if (!el) return;
        const startTxt = (el.textContent || '0').replace(/\D/g, '') || '0';
        const start = parseInt(startTxt, 10);
        const end = targetValue;
        if (start === end) { el.textContent = `⭐ ${end}`; return; }
        const dur = 450;
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - t, 3);
            const v = Math.round(start + (end - start) * eased);
            el.textContent = `⭐ ${v}`;
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function celebrateAvatar() {
        const a = document.getElementById('game-avatar');
        if (!a) return;
        a.classList.remove('celebrate', 'shake');
        void a.offsetWidth;
        a.classList.add('celebrate');
        setTimeout(() => a.classList.remove('celebrate'), 900);
    }

    function shakeAvatar() {
        const a = document.getElementById('game-avatar');
        if (!a) return;
        a.classList.remove('celebrate', 'shake');
        void a.offsetWidth;
        a.classList.add('shake');
        setTimeout(() => a.classList.remove('shake'), 600);
    }

    /* In-game motivational quote — pokazuje sie w progress-pill po
       odpowiedzi, znika po 2.5s wracajac do domyslnego tekstu. */
    let quoteResetTimer = null;
    function showInGameQuote(text, kind) {
        const pill = document.querySelector('.progress-pill');
        if (!pill) return;
        pill.textContent = text;
        pill.classList.remove('quote-good', 'quote-bad', 'quote-show');
        void pill.offsetWidth;
        pill.classList.add('quote-show', kind === 'good' ? 'quote-good' : 'quote-bad');
        clearTimeout(quoteResetTimer);
        quoteResetTimer = setTimeout(() => {
            pill.textContent = 'Buduj serię poprawnych odpowiedzi';
            pill.classList.remove('quote-good', 'quote-bad', 'quote-show');
        }, 2500);
    }

    /* ============================================================
       NAVIGATION & HELPERS
       ============================================================ */
    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }

    /* Aktualizuje etykietę przycisku Pełny ekran/Wyjdź zależnie od stanu */
    function updateFullscreenButton() {
        const btn = document.querySelector('.ptn-btn-fs');
        if (!btn) return;
        const icon = btn.querySelector('.ptn-icon');
        const lbl = btn.querySelector('.ptn-lbl');
        const inFs = !!document.fullscreenElement;
        if (icon) icon.textContent = inFs ? '⛶' : '⛶';
        if (lbl) lbl.textContent = inFs ? 'Wyjdź' : 'Pełny ekran';
        btn.setAttribute('aria-label', inFs ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran');
        btn.title = inFs ? 'Wyjdź z trybu pełnoekranowego' : 'Włącz tryb pełnoekranowy';
    }

    // Słuchaj zmian fullscreen — różne prefiksy dla cross-browser
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
        .forEach(ev => document.addEventListener(ev, updateFullscreenButton));

    function switchScreen(id) {
        ["screen-profile", "screen-setup", "screen-game"].forEach((screenId) => {
            const el = document.getElementById(screenId);
            if (!el) return;
            if (screenId === id) {
                el.classList.add('is-active');
            } else {
                el.classList.remove('is-active');
            }
        });
        // Toggle body class so CSS can lock viewport during gameplay
        // (especially on mobile where we want a no-scroll, 100dvh layout).
        document.body.classList.toggle('game-active', id === 'screen-game');
        // Refresh Top-3 list whenever user returns to profile (could be after a game).
        if (id === 'screen-profile') renderProfileTopList();
    }

    function goToSetup() {
        // Jeśli użytkownik nie wpisał imienia ale mamy ostatniego gracza — ładuj go
        const typedName = document.getElementById("username").value.trim();
        if (typedName) {
            user.name = typedName;
        } else if (user.name === 'Gracz') {
            const last = loadLastUser();
            if (last) { user.name = last.name; user.avatar = last.avatar; }
        }
        document.getElementById("current-avatar-display").textContent = user.avatar;
        document.getElementById("greeting-name").textContent = `Cześć, ${user.name}!`;
        switchScreen("screen-setup");

        // Asynchronicznie probuje zarezerwowac username w chmurze.
        // Nie blokujemy UX — gracz juz przeszedl do setupu. Jezeli zajete,
        // pokazemy alert ale gra dziala dalej offline.
        if (cloudReady && user.name && user.name !== 'Gracz') {
            cloudClaimUsername(user.name, user.avatar).then((ok) => {
                if (!ok) {
                    showAlert(
                        'Nazwa zajęta',
                        `Nazwa "${user.name}" jest już używana w globalnym rankingu. Twoje wyniki zapiszą się lokalnie. Wróć do profilu i wybierz inną nazwę aby trafiać też do rankingu globalnego.`,
                        '⚠️',
                        null
                    );
                }
            });
        }
    }

    function backToSetup() {
        document.getElementById("modal-report").style.display = "none";
        switchScreen("screen-setup");
    }

    function setDiff(diff, btn) {
        settings.diff = diff;
        document.querySelectorAll(".btn-diff").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
    }

    function showAlert(title, text, icon, onOk) {
        const modal = document.getElementById("modal-alert");
        document.getElementById("alert-title").textContent = title;
        document.getElementById("alert-text").textContent = text;
        document.getElementById("alert-icon").textContent = icon;

        const btnOk = document.getElementById("alert-ok");
        const btnCancel = document.getElementById("alert-cancel");
        const nextOk = btnOk.cloneNode(true);
        const nextCancel = btnCancel.cloneNode(true);
        btnOk.parentNode.replaceChild(nextOk, btnOk);
        btnCancel.parentNode.replaceChild(nextCancel, btnCancel);

        nextOk.onclick = () => {
            modal.style.display = "none";
            if (onOk) onOk();
        };

        if (onOk) {
            nextCancel.style.display = "block";
            nextCancel.onclick = () => { modal.style.display = "none"; };
        } else {
            nextCancel.style.display = "none";
        }

        modal.style.display = "flex";
    }

    function getDiffLimit() {
        if (settings.diff === "medium") return 500;
        if (settings.diff === "hard") return 1000;
        return 100;
    }

    function getModeLabel(mode) {
        if (mode === "add") return "Dodawanie";
        if (mode === "sub") return "Odejmowanie";
        if (mode === "mul") return "Mnożenie";
        if (mode === "div") return "Dzielenie";
        return "Losowy mix";
    }

    function getDiffName(diff) {
        if (diff === "medium") return "Podróżnik";
        if (diff === "hard") return "Mistrz";
        return "Odkrywca";
    }

    function getSessionLabel(minutes) {
        if (minutes === 0) return "Trening bez limitu";
        if (minutes === 1) return "1 minuta";
        return `${minutes} minuty`;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => {
            if (char === "&") return "&amp;";
            if (char === "<") return "&lt;";
            if (char === ">") return "&gt;";
            if (char === '"') return "&quot;";
            return "&#39;";
        });
    }

    function loadLeaderboardData() {
        const primary = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (Array.isArray(primary) && primary.length) return primary;
        const legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || "null");
        if (Array.isArray(legacy) && legacy.length) return legacy;
        return Array.isArray(primary) ? primary : [];
    }

    function persistLeaderboardData(data) {
        localStorage.setItem(storageKey, JSON.stringify(data));
        if (localStorage.getItem(legacyStorageKey)) {
            localStorage.removeItem(legacyStorageKey);
        }
    }

    /* ---------- Last-user memory ---------- */
    function saveLastUser() {
        try {
            localStorage.setItem(lastUserKey, JSON.stringify({
                name: user.name,
                avatar: user.avatar,
                ts: Date.now()
            }));
        } catch (e) { /* ignore quota errors */ }
    }

    function loadLastUser() {
        try {
            const raw = localStorage.getItem(lastUserKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.name || !parsed.avatar) return null;
            return parsed;
        } catch (e) { return null; }
    }

    function formatRelativeTime(ts) {
        if (!ts) return "dawno temu";
        const diff = Date.now() - ts;
        const min = Math.floor(diff / 60000);
        const hr = Math.floor(diff / 3600000);
        const day = Math.floor(diff / 86400000);
        const date = new Date(ts);
        const dateStr = date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
        if (min < 1) return `przed chwilą (${dateStr})`;
        if (min < 60) return `${min} min temu (${dateStr})`;
        if (hr < 24) return `${hr} godz. temu (${dateStr})`;
        if (day === 1) return `wczoraj o ${date.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
        if (day < 7) return `${day} dni temu (${dateStr})`;
        return dateStr;
    }

    function renderWelcomeBack() {
        const banner = document.getElementById('welcome-back');
        const top = document.getElementById('profile-top');
        const grid = document.querySelector('.profile-grid');
        const last = loadLastUser();
        if (!banner) return;
        if (!last) {
            // Brak ostatniego gracza — ukryj profile-top, pokaż formularz dla nowego
            if (banner) banner.style.display = '';
            if (top) top.style.display = '';
            if (grid) grid.style.display = '';
            document.body.classList.remove('has-returning-user');
            return;
        }
        document.getElementById('welcome-avatar').textContent = last.avatar;
        document.getElementById('welcome-name').textContent = `Witaj, ${last.name}!`;
        document.getElementById('welcome-meta').textContent = `Ostatnia gra: ${formatRelativeTime(last.ts)}`;
        // Wyczyść inline display — niech CSS body.has-returning-user steruje widocznością
        if (banner) banner.style.display = '';
        if (top) top.style.display = '';
        if (grid) grid.style.display = '';
        document.body.classList.add('has-returning-user');
        // Wypełnij mini-statystyki w welcome hero card
        renderWelcomeStats(last.name);
    }

    function renderWelcomeStats(playerName) {
        const scores = loadLeaderboardData();
        const mine = scores.filter(s => s.n === playerName);
        const best = mine.length ? Math.max(...mine.map(s => s.s)) : null;
        const avg  = mine.length ? Math.round(mine.reduce((a, s) => a + s.s, 0) / mine.length) : null;

        const elBest  = document.getElementById('stat-best');
        const elGames = document.getElementById('stat-games');
        const elAvg   = document.getElementById('stat-avg');

        if (elBest)  elBest.textContent  = best  !== null ? best  : '—';
        if (elGames) elGames.textContent = mine.length > 0 ? mine.length : '—';
        if (elAvg)   elAvg.textContent   = avg   !== null ? avg   : '—';

        // Wypełnij dashboard: ostatnia rozgrywka + ciekawostka
        renderDashboardRecent(mine);
        renderDashboardFact();
    }

    function renderDashboardRecent(myScores) {
        const elScore = document.getElementById('recent-score');
        const elMode  = document.getElementById('recent-mode');
        const elDiff  = document.getElementById('recent-diff');
        if (!elScore) return;

        if (!myScores || !myScores.length) {
            elScore.textContent = '—';
            elMode.textContent  = '—';
            elDiff.textContent  = '—';
            return;
        }
        // Ostatnia (najnowsza) gra — ostatni element listy localStorage
        const last = myScores[myScores.length - 1];
        elScore.textContent = last.s;
        elMode.textContent  = getModeLabel(last.m) || '—';
        elDiff.textContent  = getDiffName(last.diff) || '—';
    }

    function renderDashboardFact() {
        // Stary widget pd-fact-text został zastąpiony przez profile-fact-widget (#pfw-text)
        // Jeśli stary jeszcze istnieje gdzieś — wypełnij dla kompatybilności
        const oldEl = document.getElementById('pd-fact-text');
        if (oldEl && mathFacts && mathFacts.length) {
            oldEl.textContent = mathFacts[Math.floor(Math.random() * mathFacts.length)];
        }
        // Nowy fact widget (top-right) — start auto-rotacji
        startProfileFactRotation();
    }

    /* ===== PROFILE FACT WIDGET — auto-rotacja co 10s + manual next ===== */
    let pfwState = { idx: 0, intervalId: null, progressId: null };
    const PFW_INTERVAL_MS = 10000;

    function startProfileFactRotation() {
        const textEl = document.getElementById('pfw-text');
        if (!textEl || !mathFacts || !mathFacts.length) return;
        // Reset state if already running
        if (pfwState.intervalId) clearInterval(pfwState.intervalId);
        if (pfwState.progressId) clearInterval(pfwState.progressId);
        pfwState.idx = Math.floor(Math.random() * mathFacts.length);
        renderCurrentFact();
        // Auto-cycle
        pfwState.intervalId = setInterval(() => nextFact(true), PFW_INTERVAL_MS);
        startFactProgress();
    }

    function renderCurrentFact() {
        const textEl = document.getElementById('pfw-text');
        if (!textEl) return;
        textEl.textContent = mathFacts[pfwState.idx];
        // Re-trigger animacji wejścia
        textEl.style.animation = 'none';
        void textEl.offsetWidth;
        textEl.style.animation = '';
    }

    function nextFact(auto) {
        if (!mathFacts || !mathFacts.length) return;
        let next = pfwState.idx;
        // Unikaj powtórzenia bezpośredniego (jeśli > 1 fakt)
        if (mathFacts.length > 1) {
            while (next === pfwState.idx) next = Math.floor(Math.random() * mathFacts.length);
        }
        pfwState.idx = next;
        renderCurrentFact();
        // Manual next — zresetuj timer
        if (!auto) {
            if (pfwState.intervalId) clearInterval(pfwState.intervalId);
            pfwState.intervalId = setInterval(() => nextFact(true), PFW_INTERVAL_MS);
        }
        startFactProgress();
    }

    function startFactProgress() {
        const bar = document.getElementById('pfw-progress-bar');
        if (!bar) return;
        if (pfwState.progressId) clearInterval(pfwState.progressId);
        let elapsed = 0;
        bar.style.width = '0%';
        const tickMs = 100;
        pfwState.progressId = setInterval(() => {
            elapsed += tickMs;
            const pct = Math.min(100, (elapsed / PFW_INTERVAL_MS) * 100);
            bar.style.width = pct + '%';
            if (pct >= 100) clearInterval(pfwState.progressId);
        }, tickMs);
    }

    function welcomeContinue() {
        const last = loadLastUser();
        if (!last) return;
        user.name = last.name;
        user.avatar = last.avatar;
        // Update form so if user comes back to profile via 'Zmień profil' they see correct data
        const username = document.getElementById('username');
        if (username) username.value = last.name;
        document.querySelectorAll('.avatar-option').forEach((el) => {
            el.classList.toggle('selected', el.textContent.trim() === last.avatar);
        });
        document.getElementById("current-avatar-display").textContent = user.avatar;
        document.getElementById("greeting-name").textContent = `Cześć, ${user.name}!`;
        switchScreen('screen-setup');
    }

    /* ---- LESSON modal — mini-lekcje matematyczne ---- */
    const lessons = {
        add: {
            title: 'Dodawanie',
            subtitle: 'Łączymy zbiory — sumujemy elementy',
            theme: 'add',
            html: `
                <section class="lesson-section">
                    <h3><span class="lesson-icon">📖</span>Co to jest dodawanie?</h3>
                    <p>Dodawanie to <strong>łączenie</strong> dwóch (lub więcej) liczb w jedną — sumę. Jeśli masz <span class="lesson-eq">3</span> jabłka i ktoś da Ci jeszcze <span class="lesson-eq">4</span>, masz razem <span class="lesson-eq">7</span>. Liczby które dodajesz to <strong>składniki</strong>, a wynik to <strong>suma</strong>.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">🔄</span>Przemienność</h3>
                    <p>Kolejność składników nie zmienia wyniku: <span class="lesson-eq">a + b = b + a</span>.</p>
                    <div class="lesson-examples">
                        <div class="lesson-example">3 + 5 = 8<small>= 5 + 3</small></div>
                        <div class="lesson-example">12 + 7 = 19<small>= 7 + 12</small></div>
                    </div>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">🔗</span>Łączność</h3>
                    <p>Możesz dodawać w dowolnej kolejności — <span class="lesson-eq">(a + b) + c = a + (b + c)</span>. Jeśli to ułatwia, najpierw zsumuj te liczby które się ładnie zaokrąglają.</p>
                    <div class="lesson-examples">
                        <div class="lesson-example">17 + 8 + 3<small>= 17 + 11 = 28</small></div>
                        <div class="lesson-example">17 + 3 + 8<small>= 20 + 8 = 28</small></div>
                    </div>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">⚪</span>Element neutralny</h3>
                    <p>Dodawanie zera nic nie zmienia: <span class="lesson-eq">a + 0 = a</span>.</p>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Trick: uzupełnianie do dziesiątki</h3>
                    <p>Najszybciej liczy się gdy wyniki "zaokrąglają się" do <strong>10, 20, 100</strong>. Przy <span class="lesson-eq">8 + 7</span> rozłóż <span class="lesson-eq">7 = 2 + 5</span>: <span class="lesson-eq">8 + 2 = 10</span>, potem <span class="lesson-eq">+ 5 = 15</span>. Zamiast pamiętać tabelę, używaj 10 jako "punktu odpoczynku".</p>
                </section>
            `
        },

        sub: {
            title: 'Odejmowanie',
            subtitle: 'Zabieramy część — szukamy różnicy',
            theme: 'sub',
            html: `
                <section class="lesson-section">
                    <h3><span class="lesson-icon">📖</span>Co to jest odejmowanie?</h3>
                    <p>Odejmowanie to <strong>zabieranie</strong> jednej liczby od drugiej. Wynik nazywamy <strong>różnicą</strong>. Jeśli masz <span class="lesson-eq">10</span> cukierków i zjesz <span class="lesson-eq">3</span>, zostaje <span class="lesson-eq">7</span>.</p>
                </section>

                <section class="lesson-section lesson-warn">
                    <h3><span class="lesson-icon">⚠️</span>NIE jest przemienne</h3>
                    <p>Inaczej niż w dodawaniu — kolejność <strong>ma znaczenie</strong>: <span class="lesson-eq">10 - 3 = 7</span>, ale <span class="lesson-eq">3 - 10 = -7</span> (liczba ujemna). Najpierw piszemy większą liczbę, potem to co odejmujemy.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">🔁</span>Sprawdzenie odpowiedzi</h3>
                    <p>Wynik odejmowania możesz sprawdzić dodawaniem: jeśli <span class="lesson-eq">a - b = c</span>, to <span class="lesson-eq">b + c = a</span>.</p>
                    <div class="lesson-examples">
                        <div class="lesson-example">15 - 7 = 8<small>sprawdź: 7 + 8 = 15 ✓</small></div>
                        <div class="lesson-example">23 - 9 = 14<small>sprawdź: 9 + 14 = 23 ✓</small></div>
                    </div>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Trick: dziesiątki "zostawiamy w pamięci"</h3>
                    <p>Przy <span class="lesson-eq">42 - 17</span> rozbij na kroki: najpierw odejmij <span class="lesson-eq">10</span> — zostaje <span class="lesson-eq">32</span>. Potem <span class="lesson-eq">7</span>. Bo <span class="lesson-eq">32 - 7</span> wymaga "pożyczki": <span class="lesson-eq">32 - 2 = 30</span>, jeszcze <span class="lesson-eq">5</span> = <span class="lesson-eq">25</span>.</p>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Trick: dopełnianie</h3>
                    <p>Często łatwiej zapytać "ile brakuje?". <span class="lesson-eq">14 - 9</span> = "ile brakuje od 9 do 14?" → <span class="lesson-eq">9 + 1 = 10, +4 = 14</span>, więc <span class="lesson-eq">5</span>.</p>
                </section>
            `
        },

        mul: {
            title: 'Mnożenie',
            subtitle: 'Powtarzamy dodawanie wiele razy',
            theme: 'mul',
            html: `
                <section class="lesson-section">
                    <h3><span class="lesson-icon">📖</span>Co to jest mnożenie?</h3>
                    <p>Mnożenie to <strong>skrócone dodawanie</strong> tej samej liczby kilka razy. <span class="lesson-eq">4 × 3</span> oznacza "cztery razy po trzy" = <span class="lesson-eq">3 + 3 + 3 + 3 = 12</span>. Liczby które mnożymy to <strong>czynniki</strong>, wynik to <strong>iloczyn</strong>.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">🔄</span>Przemienność</h3>
                    <p>Kolejność czynników nie zmienia wyniku: <span class="lesson-eq">a × b = b × a</span>. <span class="lesson-eq">7 × 8 = 8 × 7 = 56</span>.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">⚪</span>Element neutralny i zero</h3>
                    <p>Mnożenie przez <strong>1</strong> nic nie zmienia: <span class="lesson-eq">a × 1 = a</span>. Mnożenie przez <strong>0</strong> daje zawsze <strong>0</strong>: <span class="lesson-eq">a × 0 = 0</span>.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">🧮</span>Tabliczka — najważniejsze</h3>
                    <div class="lesson-examples">
                        <div class="lesson-example">6 × 7 = 42</div>
                        <div class="lesson-example">7 × 8 = 56</div>
                        <div class="lesson-example">8 × 9 = 72</div>
                        <div class="lesson-example">9 × 7 = 63</div>
                    </div>
                    <p style="margin-top: 8px;">Dwa najtrudniejsze rzędy to <strong>7</strong> i <strong>8</strong> — warto je powtarzać. Reszta wpada szybciej.</p>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Trick: tabliczka 9</h3>
                    <p>W mnożeniu przez <strong>9</strong>: cyfra dziesiątek to (n−1), cyfra jedności to (10−n). Np. <span class="lesson-eq">9 × 7</span>: 7−1 = 6, 10−7 = 3 → <span class="lesson-eq">63</span>. Suma cyfr wyniku zawsze daje <strong>9</strong>!</p>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Rozdzielność (sztuczka na trudne)</h3>
                    <p><span class="lesson-eq">a × (b + c) = a × b + a × c</span>. Trudne <span class="lesson-eq">7 × 13</span>? Zrób <span class="lesson-eq">7 × 10 + 7 × 3 = 70 + 21 = 91</span>.</p>
                </section>
            `
        },

        div: {
            title: 'Dzielenie',
            subtitle: 'Rozdzielamy na równe części',
            theme: 'div',
            html: `
                <section class="lesson-section">
                    <h3><span class="lesson-icon">📖</span>Co to jest dzielenie?</h3>
                    <p>Dzielenie to <strong>podział</strong> liczby na równe części. <span class="lesson-eq">12 ÷ 4</span> oznacza "podziel 12 na 4 równe części" — każda będzie miała <span class="lesson-eq">3</span>. Liczba dzielona to <strong>dzielna</strong>, dzielnik to przez ile dzielimy, wynik to <strong>iloraz</strong>.</p>
                </section>

                <section class="lesson-section lesson-warn">
                    <h3><span class="lesson-icon">⚠️</span>NIE jest przemienne</h3>
                    <p>Tak jak odejmowanie — kolejność ma znaczenie: <span class="lesson-eq">12 ÷ 4 = 3</span>, ale <span class="lesson-eq">4 ÷ 12</span> ≈ <span class="lesson-eq">0,33</span>.</p>
                </section>

                <section class="lesson-section lesson-warn">
                    <h3><span class="lesson-icon">🚫</span>Dzielenie przez zero</h3>
                    <p><strong>Niemożliwe.</strong> Nie da się rozdzielić niczego na zero części. Przy <span class="lesson-eq">a ÷ 0</span> matematyka zatrzymuje się — wynik nie istnieje.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">🔁</span>Sprawdzenie odpowiedzi</h3>
                    <p>Dzielenie to "odwrotność" mnożenia: jeśli <span class="lesson-eq">a ÷ b = c</span>, to <span class="lesson-eq">b × c = a</span>.</p>
                    <div class="lesson-examples">
                        <div class="lesson-example">56 ÷ 7 = 8<small>sprawdź: 7 × 8 = 56 ✓</small></div>
                        <div class="lesson-example">81 ÷ 9 = 9<small>sprawdź: 9 × 9 = 81 ✓</small></div>
                    </div>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Trick: szukaj w tabliczce</h3>
                    <p>Przy <span class="lesson-eq">42 ÷ 6</span> zapytaj: "6 razy ile to 42?". Z tabliczki: <span class="lesson-eq">6 × 7 = 42</span>, więc odpowiedź to <span class="lesson-eq">7</span>. Dzielenie i mnożenie to dwie strony tej samej monety.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">📐</span>Reszta z dzielenia</h3>
                    <p>Nie zawsze liczby dzielą się "równo". <span class="lesson-eq">17 ÷ 5</span> = <span class="lesson-eq">3</span> reszta <span class="lesson-eq">2</span> (bo <span class="lesson-eq">5 × 3 = 15</span>, do 17 brakuje 2). W tej grze zawsze trafiasz w działania bez reszty — żeby było czysto.</p>
                </section>
            `
        },

        mix: {
            title: 'Losowy mix',
            subtitle: 'Wszystkie cztery działania pomieszane',
            theme: 'mix',
            html: `
                <section class="lesson-section">
                    <h3><span class="lesson-icon">🎲</span>Co Cię tu czeka?</h3>
                    <p>W trybie mix dostajesz <strong>na zmianę</strong> dodawanie, odejmowanie, mnożenie i dzielenie — losowo. To prawdziwy test refleksu — musisz natychmiast rozpoznać znak działania i przełączyć tryb myślenia.</p>
                </section>

                <section class="lesson-section">
                    <h3><span class="lesson-icon">📚</span>Sprawdź zasady każdego działania</h3>
                    <p>Każda misja ma swoją mini-lekcję. Wróć do ekranu i kliknij <strong>?</strong> przy:</p>
                    <div class="lesson-examples">
                        <div class="lesson-example">➕ Dodawanie</div>
                        <div class="lesson-example">➖ Odejmowanie</div>
                        <div class="lesson-example">✖️ Mnożenie</div>
                        <div class="lesson-example">➗ Dzielenie</div>
                    </div>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">💡</span>Trick na mix: rozpoznaj znak najpierw</h3>
                    <p>Zanim zaczniesz liczyć — spójrz <strong>tylko na znak</strong> działania (➕ ➖ ✖️ ➗). Twój mózg automatycznie przełączy się w odpowiedni tryb. Próba liczenia bez tej "chwili oddechu" prowadzi do błędów.</p>
                </section>

                <section class="lesson-section lesson-tip">
                    <h3><span class="lesson-icon">🔥</span>Strategia na combo</h3>
                    <p>W mixie najtrudniej utrzymać długą serię. Trick: jeżeli pytanie wydaje Ci się trudne, weź sekundę dłużej zamiast strzelać. Combo zerujesz przy jednym błędzie, więc lepsze 5 sekund spokoju niż 1 sekunda i pomyłka.</p>
                </section>
            `
        }
    };

    let lessonModeInQueue = null; // dla 'Zacznij grać' przycisku w stopce

    function showLesson(mode) {
        const data = lessons[mode];
        if (!data) return;
        lessonModeInQueue = mode;
        document.getElementById('lesson-title').textContent = data.title;
        document.getElementById('lesson-subtitle').textContent = data.subtitle;
        document.getElementById('lesson-content').innerHTML = data.html;
        const header = document.getElementById('lesson-header');
        header.className = 'modal-header theme-' + data.theme;
        // Scroll body do gory
        const body = document.querySelector('#modal-lesson .modal-body');
        if (body) body.scrollTop = 0;
        document.getElementById('modal-lesson').style.display = 'flex';
    }

    function closeLesson() {
        document.getElementById('modal-lesson').style.display = 'none';
        lessonModeInQueue = null;
    }

    function lessonStartGame() {
        const mode = lessonModeInQueue;
        closeLesson();
        if (mode) startGame(mode);
    }

    /* ---- EDIT PROFILE modal ---- */
    async function showEditProfile() {
        const modal = document.getElementById('modal-edit-profile');
        if (!modal) return;

        // Zamknij modal-konto jezeli byl otwarty — w przeciwnym razie
        // edit-profile pojawia sie POD nim (same z-index, MIME order).
        const accModal = document.getElementById('modal-account');
        if (accModal) accModal.style.display = 'none';

        // Wymagamy persistent account
        if (!cloudReady || !cloudUser || !cloudUser._persistent) {
            const status = document.getElementById('ep-status');
            if (status) {
                status.className = 'acc-status is-shown is-info';
                status.textContent = 'Najpierw stwórz trwałe konto (Konto → Stwórz konto). Wtedy możesz wypełnić profil.';
            }
            ['ep-school','ep-class','ep-city','ep-journal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            modal.style.display = 'flex';
            return;
        }

        // FRESH READ z bazy — nie polegaj na cache w cloudUser.profile,
        // bo moze byc stale po edycji z innego urzadzenia.
        const status = document.getElementById('ep-status');
        if (status) {
            status.className = 'acc-status is-shown is-info';
            status.textContent = '⏳ Wczytuję profil...';
        }
        ['ep-school','ep-class','ep-city','ep-journal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        modal.style.display = 'flex';

        try {
            const { data, error } = await withFallbackTimeout(
                sb.from('profiles')
                    .select('school, class_name, city, journal_no')
                    .eq('id', cloudUser.id)
                    .maybeSingle(),
                5000,
                { data: null, error: { message: 'timeout' } }
            );
            if (error) throw error;
            const p = data || {};
            // Update cache zeby zostal w sync
            if (cloudUser.profile) {
                cloudUser.profile.school = p.school || null;
                cloudUser.profile.class_name = p.class_name || null;
                cloudUser.profile.city = p.city || null;
                cloudUser.profile.journal_no = p.journal_no || null;
            }
            document.getElementById('ep-school').value = p.school || '';
            document.getElementById('ep-class').value = p.class_name || '';
            document.getElementById('ep-city').value = p.city || '';
            document.getElementById('ep-journal').value = p.journal_no || '';
            if (status) { status.textContent = ''; status.className = 'acc-status'; }
        } catch (e) {
            console.warn('[edit-profile] read failed', e && e.message);
            // Fallback do cache
            const p = (cloudUser && cloudUser.profile) || {};
            document.getElementById('ep-school').value = p.school || '';
            document.getElementById('ep-class').value = p.class_name || '';
            document.getElementById('ep-city').value = p.city || '';
            document.getElementById('ep-journal').value = p.journal_no || '';
            if (status) {
                status.className = 'acc-status is-shown is-bad';
                status.textContent = '⚠ Nie udało się wczytać świeżych danych. Pokazuję ostatnio znane.';
            }
        }
    }

    function closeEditProfile() {
        const modal = document.getElementById('modal-edit-profile');
        if (modal) modal.style.display = 'none';
    }

    async function saveEditProfile() {
        const status = document.getElementById('ep-status');
        const setStatus = (text, kind) => {
            if (!status) return;
            status.textContent = text;
            status.className = 'acc-status is-shown' + (kind ? ' is-' + kind : '');
        };

        const school = document.getElementById('ep-school').value.trim();
        const className = document.getElementById('ep-class').value.trim();
        const city = document.getElementById('ep-city').value.trim();
        const journalRaw = document.getElementById('ep-journal').value.trim();
        const journal = journalRaw ? parseInt(journalRaw, 10) : null;

        if (className && !/^[0-9]+[A-Za-z]*$/.test(className)) {
            setStatus('Klasa: format taki jak 1A, 2B, 5C', 'bad');
            return;
        }
        if (journal && (journal < 1 || journal > 99)) {
            setStatus('Nr w dzienniku: 1-99', 'bad');
            return;
        }

        setStatus('⏳ Zapisuję...', 'info');
        try {
            const result = await cloudUpdateProfile({
                school, class_name: className, city, journal_no: journal,
                avatar: user.avatar
            });
            console.info('[edit-profile] saved:', result && result.profile);
            // Werifikacja: fresh read po zapisie
            const { data: verify } = await sb.from('profiles')
                .select('school, class_name, city, journal_no')
                .eq('id', cloudUser.id)
                .maybeSingle();
            console.info('[edit-profile] verify after save:', verify);
            setStatus('✓ Profil zapisany', 'good');
            renderWelcomeBack();
            setTimeout(() => closeEditProfile(), 1200);
        } catch (e) {
            setStatus('⚠ ' + (e.message || 'Nie udało się zapisać'), 'bad');
        }
    }

    function welcomeChange() {
        // Nie uzywaj natywnego confirm() — uzyj naszego stylowanego showAlert
        showAlert(
            'Wylogować obecnego gracza?',
            'Na tym urządzeniu rozpoczniesz od czystego ekranu. Inne urządzenia tego konta (jeśli istnieją) pozostają zalogowane.',
            '↺',
            () => performWelcomeChange()
        );
    }

    async function performWelcomeChange() {
        // 1) Wyloguj z chmury LOCALNIE (scope:'local' — inne urzadzenia
        //    tego samego konta dalej zalogowane).
        if (cloudReady && cloudUser && cloudUser._persistent) {
            try { await cloudSignOut(); }
            catch (e) { console.warn('[welcomeChange] signOut failed:', e && e.message); }
        }

        // 2) Usun zapamietanego ostatniego gracza
        try { localStorage.removeItem(lastUserKey); } catch (_) {}

        // 3) Reset stanu user
        user = { name: 'Gracz', avatar: '🦉' };

        // 4) Wyczysc formularz, przywroc default avatar selection
        const usernameInput = document.getElementById('username');
        if (usernameInput) usernameInput.value = '';
        document.querySelectorAll('.avatar-option').forEach(a => {
            a.classList.toggle('selected', a.textContent.trim() === '🦉');
        });
        const cur = document.getElementById('avatar-current');
        if (cur) cur.textContent = '🦉';

        // 5) Schowaj welcome-back i powiazane widgety przez KLASE
        //    (style.display 'none' walczylo z CSS [style*="..."] selektorami).
        const banner = document.getElementById('welcome-back');
        const top = document.getElementById('profile-top');
        if (banner) { banner.classList.add('is-hidden'); banner.style.display = ''; }
        if (top) { top.classList.add('is-hidden'); top.style.display = ''; }
        document.body.classList.remove('has-returning-user');
        const grid = document.querySelector('.profile-grid');
        if (grid) grid.style.display = '';
        if (typeof pfwState !== 'undefined') {
            if (pfwState.intervalId) { clearInterval(pfwState.intervalId); pfwState.intervalId = null; }
            if (pfwState.progressId) { clearInterval(pfwState.progressId); pfwState.progressId = null; }
        }

        // 6) Pelny re-render — renderWelcomeBack znajdzie pusty lastUser i
        //    skutecznie schowa banner (zamiast polegania na style.display).
        renderWelcomeBack();
        renderProfileTopList();
        updateCloudStatusPill();

        // 7) Scroll na gore + focus na nazwe
        const main = document.querySelector('.profile-main');
        if (main && main.scrollTo) main.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => {
            if (usernameInput) usernameInput.focus();
        }, 300);
    }

    function getNextRewardMilestone(combo) {
        return rewardMilestones.find((v) => combo < v) || rewardMilestones[rewardMilestones.length - 1];
    }

    function updateProgressMeta() {
        document.getElementById("game-streak").textContent = `Seria ${gameState.combo}`;
        const next = getNextRewardMilestone(gameState.combo);
        document.getElementById("game-next-reward").textContent = gameState.combo >= 100 ? "Legenda!" : `Nagroda za ${next}`;
    }

    /* ============================================================
       GAME FLOW
       ============================================================ */
    function startGame(mode) {
        settings.mode = mode;
        settings.timeMin = parseInt(document.getElementById("timer-select").value, 10);

        // Zapamietaj usera (imie + avatar + timestamp) — pozniej przy
        // ponownym wejsciu pokazemy "Witaj ponownie!"
        saveLastUser();

        clearInterval(gameState.timerInterval);
        gameState = {
            score: 0, history: [], timerInterval: null, endTime: 0,
            active: true, combo: 0,
            questionsSeen: new Set() // dedup w sesji
        };

        document.getElementById("modal-report").style.display = "none";
        document.getElementById("modal-alert").style.display = "none";
        document.getElementById("ingame-rewards").innerHTML = "";
        document.getElementById("game-avatar").textContent = user.avatar;
        document.getElementById("game-score").textContent = "⭐ 0";
        document.getElementById("game-mode-label").textContent = getModeLabel(settings.mode);
        document.getElementById("game-difficulty-label").textContent = getDiffName(settings.diff);
        document.getElementById("game-session-label").textContent = getSessionLabel(settings.timeMin);
        document.getElementById("game-timer").classList.remove("is-urgent");

        updateComboUI();
        updateProgressMeta();
        updateRing(0);
        switchScreen("screen-game");

        if (settings.timeMin > 0) {
            gameState.endTime = Date.now() + settings.timeMin * 60000;
            updateTimer();
            gameState.timerInterval = setInterval(updateTimer, 1000);
        } else {
            document.getElementById("game-timer").textContent = "∞";
        }

        nextQuestion();
    }

    function updateTimer() {
        const remaining = Math.ceil((gameState.endTime - Date.now()) / 1000);
        const timer = document.getElementById("game-timer");

        if (remaining <= 0) {
            timer.textContent = "0:00";
            timer.classList.add("is-urgent");
            if (gameState.active) {
                gameState.active = false;
                clearInterval(gameState.timerInterval);
                showAlert("Koniec czasu!", "Świetna robota. Sprawdźmy, jak poszła ta sesja.", "⏰", () => endGame(true));
            }
            return;
        }

        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        timer.textContent = `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
        const urgent = remaining <= 10;
        timer.classList.toggle("is-urgent", urgent);

        // Bip co sekunde w ostatnich 10s — tylko jezeli nowa sekunda
        // (nie powtarza tego samego sample podczas tego samego ticku).
        if (urgent && remaining >= 1 && remaining !== gameState._lastBipAt) {
            gameState._lastBipAt = remaining;
            playSound('bip');
        }
    }

    /** Generuje jedno losowe pytanie. Wynik jest CZYSTY (nie modyfikuje stanu). */
    function generateQuestion() {
        const mode = settings.mode === "mix"
            ? ["add", "sub", "mul", "div"][Math.floor(Math.random() * 4)]
            : settings.mode;
        const max = getDiffLimit();
        let a, b, correct, symbol;

        if (mode === "add") {
            a = randomInt(Math.max(8, Math.floor(max * 0.85)));
            b = randomInt(Math.max(6, max - a));
            correct = a + b;
            symbol = "+";
        } else if (mode === "sub") {
            a = randomInt(max) + 5;
            b = randomInt(a);
            correct = a - b;
            symbol = "-";
        } else if (mode === "mul") {
            const limit = settings.diff === "easy" ? 10 : settings.diff === "medium" ? 20 : 50;
            a = randomInt(limit);
            b = randomInt(settings.diff === "hard" ? 12 : 10);
            correct = a * b;
            symbol = "×";
        } else {
            const divisorLimit = settings.diff === "easy" ? 10 : settings.diff === "medium" ? 18 : 24;
            b = randomInt(divisorLimit - 2) + 2;
            correct = randomInt(divisorLimit);
            a = b * correct;
            symbol = "÷";
        }
        return { mode, a, b, correct, symbol, text: `${a} ${symbol} ${b}` };
    }

    function nextQuestion() {
        if (!gameState.active) return;

        // Dedup: probuj wylosowac pytanie ktorego user jeszcze nie widzial
        // w tej sesji. Po MAX_ATTEMPTS prawdopodobnie wszystkie sensowne
        // kombinacje sa wyczerpane — zerujemy historie i pozwalamy na powt.
        const MAX_ATTEMPTS = 80;
        let q = generateQuestion();
        let attempts = 1;
        while (gameState.questionsSeen.has(q.text) && attempts < MAX_ATTEMPTS) {
            q = generateQuestion();
            attempts++;
        }
        if (gameState.questionsSeen.has(q.text)) {
            // Reset — wszystkie kombinacje w danej puli zostaly uzyte
            gameState.questionsSeen.clear();
        }
        gameState.questionsSeen.add(q.text);

        gameState.currentQ = { text: q.text, correct: q.correct, start: Date.now() };

        const qBox = document.getElementById("question-text");
        qBox.classList.remove('question-out');
        qBox.style.animation = 'none';
        void qBox.offsetWidth;
        qBox.style.animation = '';
        qBox.textContent = `${q.text} = ?`;
        renderOptions(buildOptions(q.correct, q.mode));
    }

    function buildOptions(correct, mode) {
        const options = new Set([correct]);
        const baseSpread = Math.max(3, Math.round(Math.max(Math.abs(correct), 10) * 0.15));
        const candidates = [
            correct + 1, correct - 1, correct + 2, correct - 2,
            correct + baseSpread, correct - baseSpread,
            correct + Math.max(5, Math.round(baseSpread / 2)),
            correct - Math.max(5, Math.round(baseSpread / 2)),
            mode === "mul" ? correct + 10 : correct + 3,
            mode === "mul" ? correct - 10 : correct - 3
        ];

        while (options.size < 4) {
            const candidate = candidates[Math.floor(Math.random() * candidates.length)] ?? correct + randomInt(12) - 6;
            if (candidate >= 0) options.add(candidate);
        }

        return [...options].sort(() => Math.random() - 0.5);
    }

    function renderOptions(options) {
        const area = document.getElementById("options-area");
        area.innerHTML = "";

        options.forEach((option, idx) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn-option";
            button.textContent = option;
            button.style.animation = `questionIn 0.45s var(--ease-spring) both`;
            button.style.animationDelay = `${idx * 0.05}s`;
            button.onclick = () => answer(button, option);
            area.appendChild(button);
        });
    }

    function answer(btn, value) {
        if (!gameState.active) return;

        const question = gameState.currentQ;
        const isCorrect = value === question.correct;
        document.querySelectorAll(".btn-option").forEach((b) => b.disabled = true);

        if (isCorrect) {
            btn.classList.add("correct");
            playSound("c");
            gameState.score += 10;
            gameState.combo += 1;
            confettiBurst(btn);
            flashOverlay('good');
            celebrateAvatar();
            checkRewards();
            showInGameQuote(getQuote('cheer'), 'good');
        } else {
            btn.classList.add("wrong");
            playSound("w");
            gameState.combo = 0;
            screenShake();
            flashOverlay('bad');
            shakeAvatar();
            document.querySelectorAll(".btn-option").forEach((b) => {
                if (parseInt(b.textContent, 10) === question.correct) {
                    b.classList.add("correct");
                }
            });
            showInGameQuote(getQuote('console'), 'bad');
        }

        animateScoreTo(gameState.score);
        bumpScoreEl();
        updateComboUI();
        updateProgressMeta();
        updateRing(gameState.combo);

        gameState.history.push({
            text: question.text,
            userAnswer: value,
            correct: question.correct,
            ok: isCorrect,
            time: (Date.now() - question.start) / 1000
        });

        setTimeout(nextQuestion, isCorrect ? 650 : 1200);
    }

    function updateComboUI() {
        const badge = document.getElementById("combo-badge");
        if (gameState.combo > 1) {
            badge.textContent = `COMBO x${gameState.combo} 🔥`;
            badge.classList.add("visible");
        } else {
            badge.classList.remove("visible");
        }
    }

    function updateRing(combo) {
        const c1 = 377;
        const p1 = Math.min(combo, 10) / 10;
        document.getElementById("r1-prog").style.strokeDashoffset = c1 - (p1 * c1);

        const c2 = 471;
        const p2 = combo > 10 ? Math.min(combo - 10, 10) / 10 : 0;
        document.getElementById("r2-prog").style.strokeDashoffset = c2 - (p2 * c2);

        const c3 = 565;
        const p3 = combo > 20 ? Math.min(combo - 20, 10) / 10 : 0;
        document.getElementById("r3-prog").style.strokeDashoffset = c3 - (p3 * c3);
    }

    function checkRewards() {
        const combo = gameState.combo;
        const standardSteps = [10, 15, 20, 25, 30, 35, 40, 45];

        if (standardSteps.includes(combo)) {
            addRewardIcon();
            playSound("lvl");
            confettiBurst(document.getElementById('ingame-rewards'));
        } else if (combo === 50) {
            clearShelfAndAddSpecial("👑 50");
            playSound("lvl");
            confettiBurst(document.querySelector('.stage-card'));
            showAlert("Niesamowite!", "50 poprawnych odpowiedzi z rzędu. To poziom mistrzowski!", "👑", null);
        } else if (combo === 100) {
            addSpecialIcon("💎 100");
            playSound("lvl");
            confettiBurst(document.querySelector('.stage-card'));
            confettiBurst(document.querySelector('.stage-card'));
            showAlert("Legendarne!", "100 poprawnych odpowiedzi. To naprawdę imponujące!", "💎", null);
        }
    }

    function addRewardIcon() {
        const shelf = document.getElementById("ingame-rewards");
        const icon = document.createElement("span");
        icon.className = "shelf-icon";
        icon.textContent = rewardsList[Math.floor(Math.random() * rewardsList.length)];
        shelf.appendChild(icon);
    }

    function clearShelfAndAddSpecial(text) {
        const shelf = document.getElementById("ingame-rewards");
        shelf.innerHTML = "";
        addSpecialIcon(text);
    }

    function addSpecialIcon(text) {
        const shelf = document.getElementById("ingame-rewards");
        const icon = document.createElement("span");
        icon.className = "shelf-icon special";
        icon.textContent = text;
        shelf.appendChild(icon);
    }

    function confirmExit() {
        showAlert("Przerwać grę?", "Postępy tej sesji zostaną zapisane i pokażemy pełen raport.", "🛑", () => endGame(false));
    }

    function endGame() {
        gameState.active = false;
        clearInterval(gameState.timerInterval);
        document.getElementById("modal-alert").style.display = "none";

        saveScore();
        generateReport(null);

        document.getElementById("modal-report").style.display = "flex";
        document.getElementById("report-live-footer").style.display = "block";
        document.getElementById("report-archive-footer").style.display = "none";
        document.getElementById("archive-badge").style.display = "none";

        // Gdy save sie zakonczy — odswiezamy widgety profilu zeby uzytkownik
        // od razu widzial nowy wynik bez F5. lastCloudSavePromise zostal
        // ustawiony w cloudSaveResult() przez saveScore() powyżej.
        Promise.resolve(lastCloudSavePromise).finally(() => {
            renderProfileTopList();
            renderWelcomeBack();
        });
    }

    function randomInt(limit) {
        return Math.floor(Math.random() * limit) + 1;
    }

    function saveScore() {
        if (!gameState.history.length) return;

        const leaderboard = loadLeaderboardData();
        leaderboard.push({
            n: user.name,
            a: user.avatar,
            s: gameState.score,
            d: new Date().toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }),
            m: settings.mode,
            diff: settings.diff,
            t: settings.timeMin,
            h: gameState.history
        });

        leaderboard.sort((x, y) => y.s - x.s);
        persistLeaderboardData(leaderboard.slice(0, 20));

        // Najwazniejszy moment dla cloud-sync: zapisz wynik do bazy
        // (asynchronicznie, nie blokuje wyswietlenia raportu)
        cloudSaveResult({
            score: gameState.score,
            mode: settings.mode,
            difficulty: settings.diff,
            timeMin: settings.timeMin,
            history: gameState.history
        });
    }

    let lbState = { scope: 'my', filter: 'all', rankingKind: 'schools' };

    async function showLeaderboard() {
        document.getElementById("modal-leaderboard").style.display = "flex";
        // Reset do default state
        lbState = { scope: 'my', filter: 'all', rankingKind: 'schools' };
        // Pokaz/ukryj taby zaleznie od profilu
        const profile = (cloudUser && cloudUser.profile) || {};
        const tabClass = document.querySelector('.lb-tab-class');
        const tabSchool = document.querySelector('.lb-tab-school');
        const tabCity = document.querySelector('.lb-tab-city');
        if (tabClass) tabClass.style.display = (profile.class_name && profile.school) ? '' : 'none';
        if (tabSchool) tabSchool.style.display = profile.school ? '' : 'none';
        if (tabCity) tabCity.style.display = profile.city ? '' : 'none';
        updateLbControlsUI();
        await renderLeaderboard();
    }

    function updateLbControlsUI() {
        document.querySelectorAll('.lb-tab').forEach(t => t.classList.toggle('active', t.dataset.arg === lbState.scope));
        document.querySelectorAll('.lb-filter').forEach(f => f.classList.toggle('active', f.dataset.arg === lbState.filter));
        // Filtry mode-owe ukryj na rankingach (top szkol/klas/miast nie filtruje sie po misjach)
        const filters = document.getElementById('lb-filters');
        if (filters) filters.style.display = lbState.scope === 'rankings' ? 'none' : '';
    }

    function lbScope(scope) {
        lbState.scope = scope;
        updateLbControlsUI();
        renderLeaderboard();
    }

    function lbFilter(mode) {
        lbState.filter = mode;
        updateLbControlsUI();
        renderLeaderboard();
    }

    async function renderLeaderboard() {
        const container = document.getElementById("leaderboard-content");
        const filterRow = document.getElementById('lb-filters');
        container.innerHTML = '<p class="muted-empty">⏳ Wczytuję wyniki...</p>';

        // Filtry trybu sa relevantne tylko dla wynikow individualnych
        if (filterRow) filterRow.style.display = lbState.scope === 'rankings' ? 'none' : '';

        // RANKINGI (top szkol/klas/miast) — osobny renderer z sub-tabami
        if (lbState.scope === 'rankings') {
            await renderRankingsContent(container);
            return;
        }

        const profile = (cloudUser && cloudUser.profile) || {};
        const mapEntry = (c) => ({
            n: c.username, a: c.avatar, s: c.score,
            m: c.mode, diff: c.difficulty, t: c.duration_minutes,
            d: c.played_at ? new Date(c.played_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '',
            school: c.school, class_name: c.class_name, city: c.city,
            _id: c.id, _history: c.history
        });

        let entries = [];
        let isCloud = false;

        if (lbState.scope === 'class' && cloudReady && profile.school && profile.class_name) {
            entries = (await cloudFetchClassTop(profile.school, profile.class_name, 20, lbState.filter)).map(mapEntry);
            isCloud = true;
        } else if (lbState.scope === 'school' && cloudReady && profile.school) {
            entries = (await cloudFetchSchoolTop(profile.school, 20, lbState.filter)).map(mapEntry);
            isCloud = true;
        } else if (lbState.scope === 'city' && cloudReady && profile.city) {
            entries = (await cloudFetchCityTop(profile.city, 20, lbState.filter)).map(mapEntry);
            isCloud = true;
        } else if (lbState.scope === 'global' && cloudReady) {
            entries = (await cloudFetchGlobalTop(20, lbState.filter)).map(mapEntry);
            isCloud = true;
        } else if (lbState.scope === 'my' && cloudUser && cloudUser._persistent && cloudReady) {
            const cloud = await cloudFetchMyResults(20, lbState.filter);
            entries = cloud.map(c => ({
                n: (cloudUser.profile && cloudUser.profile.username) || user.name,
                a: (cloudUser.profile && cloudUser.profile.avatar) || user.avatar,
                s: c.score, m: c.mode, diff: c.difficulty, t: c.duration_minutes,
                d: c.played_at ? new Date(c.played_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '',
                _id: c.id, _history: c.history
            }));
            isCloud = true;
        } else {
            // Anon / offline — local. Sortuj po dacie malejaco (newest first).
            entries = loadLeaderboardData().slice();
            entries.sort((a, b) => {
                const parse = (s) => {
                    if (!s) return 0;
                    const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})[, ]+(\d{1,2}):(\d{2})/);
                    if (!m) return 0;
                    return new Date(2000 + (m[3] % 100), m[2] - 1, m[1], m[4], m[5]).getTime();
                };
                return parse(b.d) - parse(a.d);
            });
            if (lbState.filter !== 'all') entries = entries.filter(e => e.m === lbState.filter);
        }

        if (!entries.length) {
            const msg = lbState.scope === 'global'
                ? 'Brak globalnych wyników w tej kategorii.'
                : 'Brak zapisanych wyników. Zagraj pierwszą misję.';
            container.innerHTML = `<p class="muted-empty">${msg}</p>`;
            return;
        }

        container.innerHTML = '';
        const list = document.createElement("div");
        list.className = "leaderboard-list";

        entries.forEach((entry, index) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "leaderboard-entry";
            if (!isCloud) {
                row.onclick = () => loadArchive(entries.indexOf(entry));
            } else if (entry._history) {
                row.onclick = () => loadCloudArchive(entry);
            }

            const meta = [
                getDiffName(entry.diff),
                entry.t === 0 ? 'Trening' : `${entry.t} min`,
                getModeLabel(entry.m)
            ];
            if (entry.school) meta.push(`🏫 ${escapeHtml(entry.school)}`);
            if (entry.class_name) meta.push(`📚 ${escapeHtml(entry.class_name)}`);
            if (entry.city) meta.push(`📍 ${escapeHtml(entry.city)}`);

            row.innerHTML = `
                <div class="leaderboard-top">
                    <div class="leaderboard-player">
                        <div class="leaderboard-rank">${index + 1}</div>
                        <div>
                            <div class="leaderboard-name">${escapeHtml(entry.a || '🦉')} ${escapeHtml(entry.n)}</div>
                            <div class="leaderboard-meta">${meta.join(' · ')}</div>
                        </div>
                    </div>
                    <div class="leaderboard-score">${entry.s}</div>
                </div>
                ${entry.d ? `<div class="leaderboard-meta">${entry.d}</div>` : ''}
            `;

            list.appendChild(row);
        });

        container.appendChild(list);
    }

    /** Render zakladki "Rankingi" — sub-tabs Szkoly/Klasy/Miasta. */
    async function renderRankingsContent(container) {
        const kind = lbState.rankingKind || 'schools';
        const viewMap = { schools: 'leaderboard_schools', classes: 'leaderboard_classes', cities: 'leaderboard_cities' };
        const view = viewMap[kind];

        // Sub-tabs UI
        const subTabsHtml = `
            <div class="lb-rankings-tabs">
                <button class="lb-rsubtab ${kind === 'schools' ? 'active' : ''}" data-action="lbRankingKind" data-arg="schools" type="button">📚 Szkoły</button>
                <button class="lb-rsubtab ${kind === 'classes' ? 'active' : ''}" data-action="lbRankingKind" data-arg="classes" type="button">🏫 Klasy</button>
                <button class="lb-rsubtab ${kind === 'cities'  ? 'active' : ''}" data-action="lbRankingKind" data-arg="cities"  type="button">🏙️ Miasta</button>
            </div>
            <div id="lb-rankings-list" class="rankings-body"><p class="muted-empty">⏳ Wczytuję ranking...</p></div>
        `;
        container.innerHTML = subTabsHtml;

        const data = await cloudFetchAggregated(view, 50);
        const list = container.querySelector('#lb-rankings-list');
        if (!list) return;
        list.innerHTML = '';
        renderAggregateList(list, kind, data);
    }

    function lbRankingKind(kind) {
        lbState.rankingKind = kind;
        renderLeaderboard();
    }

    /** Render listy agregowanej (klasy / szkoły / miasta). */
    function renderAggregateList(container, scope, data) {
        if (!data || !data.length) {
            const msg = {
                classes: 'Jeszcze nikt nie podał klasy. Wypełnij profil aby budować ranking!',
                schools: 'Jeszcze nikt nie podał szkoły. Wypełnij profil!',
                cities: 'Jeszcze nikt nie podał miasta. Wypełnij profil!'
            }[scope] || 'Brak danych';
            container.innerHTML = `<p class="muted-empty">${msg}</p>`;
            return;
        }

        // Identyfikator usera — zeby wyroznic 'twoja klasa/szkola/miasto'
        const myProfile = cloudUser && cloudUser.profile;
        const myKey = (() => {
            if (!myProfile) return null;
            if (scope === 'classes') return (myProfile.school && myProfile.class_name) ? `${myProfile.school}|${myProfile.class_name}` : null;
            if (scope === 'schools') return myProfile.school || null;
            if (scope === 'cities') return myProfile.city || null;
            return null;
        })();

        container.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'leaderboard-list aggregate-list';

        data.forEach((row, idx) => {
            const li = document.createElement('div');
            li.className = 'leaderboard-entry agg-entry';

            // Etykieta wpisu zalezy od scope
            let mainLabel, subLabel, icon;
            let key = '';
            if (scope === 'classes') {
                icon = '🏫';
                mainLabel = `${escapeHtml(row.class_name)} · ${escapeHtml(row.school)}`;
                subLabel = `${row.players_count} graczy · ${row.games_count} gier`;
                key = `${row.school}|${row.class_name}`;
            } else if (scope === 'schools') {
                icon = '🏛️';
                mainLabel = escapeHtml(row.school);
                subLabel = `${row.classes_count} klas · ${row.players_count} graczy · ${row.games_count} gier`;
                key = row.school;
            } else {
                icon = '🌆';
                mainLabel = escapeHtml(row.city);
                subLabel = `${row.schools_count} szkół · ${row.players_count} graczy · ${row.games_count} gier`;
                key = row.city;
            }

            const isMine = myKey && key === myKey;
            if (isMine) li.classList.add('agg-mine');

            const lastPlayed = row.last_played_at
                ? new Date(row.last_played_at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
                : '';

            li.innerHTML = `
                <div class="leaderboard-top">
                    <div class="leaderboard-player">
                        <div class="leaderboard-rank">${idx + 1}</div>
                        <div>
                            <div class="leaderboard-name">${icon} ${mainLabel}${isMine ? ' <span class="agg-you">to Ty!</span>' : ''}</div>
                            <div class="leaderboard-meta">${subLabel}</div>
                        </div>
                    </div>
                    <div class="leaderboard-score">${row.total_score}</div>
                </div>
                <div class="leaderboard-meta agg-extra">
                    <span>📊 śr. ${row.avg_score}</span>
                    <span>🏆 najlepszy: ${row.best_score}</span>
                    ${lastPlayed ? `<span>🕒 ${lastPlayed}</span>` : ''}
                </div>
            `;
            list.appendChild(li);
        });
        container.appendChild(list);
    }

    function loadCloudArchive(entry) {
        // Cloud entry ma history — pokaz raport bez przerabiania na archive layout
        // Recreate temporary 'source' compatible with generateReport
        const source = {
            n: entry.n, a: entry.a, s: entry.s,
            m: entry.m, diff: entry.diff, t: entry.t, d: entry.d,
            h: entry._history || []
        };
        generateReport(source);
        document.getElementById('modal-leaderboard').style.display = 'none';
        document.getElementById('modal-report').style.display = 'flex';
        document.getElementById('archive-badge').style.display = 'block';
        document.getElementById('report-live-footer').style.display = 'none';
        document.getElementById('report-archive-footer').style.display = 'block';
    }

    /** Stara nazwa dla kompatybilnosci. */
    function showLeaderboardLegacy() { return showLeaderboard(); }

    function loadArchive(index) {
        const data = loadLeaderboardData();
        const entry = data[index];
        if (!entry) return;

        generateReport(entry);
        document.getElementById("modal-leaderboard").style.display = "none";
        document.getElementById("modal-report").style.display = "flex";
        document.getElementById("archive-badge").style.display = "block";
        document.getElementById("report-live-footer").style.display = "none";
        document.getElementById("report-archive-footer").style.display = "block";
    }

    function closeReport() {
        document.getElementById("modal-report").style.display = "none";
        if (document.getElementById("archive-badge").style.display !== "none") {
            document.getElementById("modal-leaderboard").style.display = "flex";
        }
    }

    function generateReport(source) {
        const history = source ? source.h : gameState.history;
        const score = source ? source.s : gameState.score;
        const goodAnswers = history.filter((e) => e.ok).length;

        document.getElementById("res-xp").textContent = score;
        document.getElementById("res-good").textContent = goodAnswers;
        document.getElementById("res-bad").textContent = history.length - goodAnswers;
        document.getElementById("res-acc").textContent = history.length ? `${Math.round((goodAnswers / history.length) * 100)}%` : "0%";

        const historyContainer = document.getElementById("tab-history");
        historyContainer.innerHTML = "";

        history.forEach((entry) => {
            const item = document.createElement("div");
            item.className = `history-item ${entry.ok ? "h-good" : "h-bad"}`;
            const answerMarkup = entry.ok
                ? `${entry.text} = ${entry.userAnswer}`
                : `${entry.text} = <s style="color: var(--bad);">${entry.userAnswer}</s> ${entry.correct}`;

            item.innerHTML = `
                <div class="history-top">
                    <strong>${answerMarkup}</strong>
                    <span class="history-meta">${entry.time.toFixed(1)}s</span>
                </div>
                <div class="history-meta">${entry.ok ? "Poprawna odpowiedź" : "Prawidłowy wynik został podświetlony"}</div>
            `;
            historyContainer.appendChild(item);
        });

        const sorted = [...history].filter((e) => e.ok).sort((x, y) => x.time - y.time);
        fillExtremeList("list-fastest", sorted.slice(0, 5));
        fillExtremeList("list-slowest", sorted.slice().reverse().slice(0, 5));
        switchTab("summary", document.querySelector('.tab-btn[data-tab="summary"]'));
    }

    function fillExtremeList(id, items) {
        const container = document.getElementById(id);
        container.innerHTML = "";

        if (!items.length) {
            container.innerHTML = '<p class="muted-empty" style="padding: 14px;">Brak danych</p>';
            return;
        }

        items.forEach((entry) => {
            const item = document.createElement("div");
            item.className = "history-item h-good";
            item.innerHTML = `
                <div class="history-top">
                    <strong>${entry.text}</strong>
                    <span class="history-meta">⚡ ${entry.time.toFixed(1)}s</span>
                </div>
            `;
            container.appendChild(item);
        });
    }

    function switchTab(tab, button) {
        ["summary", "history", "extreme"].forEach((name) => {
            document.getElementById(`tab-${name}`).style.display = name === tab ? "block" : "none";
        });

        document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
        if (button) button.classList.add("active");
    }

    /* ============================================================
       INIT
       ============================================================ */
    function buildAvatarGrid(filter) {
        const grid = document.getElementById('avatar-grid');
        if (!grid) return;
        const q = (filter || '').trim().toLowerCase();
        grid.innerHTML = '';

        // Grupuj po kategoriach, zachowuj kolejnosc
        const byCat = {};
        for (const av of avatarLibrary) {
            if (q && !av.kw.toLowerCase().includes(q) && !av.cat.toLowerCase().includes(q)) continue;
            (byCat[av.cat] = byCat[av.cat] || []).push(av);
        }

        const catOrder = ['Zwierzęta','Morze i ptaki','Fantasy','Sport','Sztuka i nauka','Symbole'];
        let renderedAny = false;
        for (const cat of catOrder) {
            const items = byCat[cat];
            if (!items || !items.length) continue;
            renderedAny = true;
            const header = document.createElement('div');
            header.className = 'avatar-category-header';
            header.textContent = cat;
            grid.appendChild(header);
            for (const av of items) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'avatar-option' + (av.emoji === user.avatar ? ' selected' : '');
                btn.textContent = av.emoji;
                btn.title = av.kw.split(' ')[0];
                btn.dataset.kw = av.kw;
                grid.appendChild(btn);
            }
        }
        if (!renderedAny) {
            const empty = document.createElement('div');
            empty.className = 'avatar-empty';
            empty.textContent = `Brak awatarów dla "${q}"`;
            grid.appendChild(empty);
        }
    }

    function bindAvatarPicker() {
        const grid = document.getElementById('avatar-grid');
        if (grid) {
            // Event delegation — buttony tworzone dynamicznie
            grid.addEventListener('click', (ev) => {
                const btn = ev.target.closest('.avatar-option');
                if (!btn) return;
                grid.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
                btn.classList.add('selected');
                const emoji = btn.textContent.trim();
                user.avatar = emoji;
                const current = document.getElementById('avatar-current');
                if (current) current.textContent = emoji;
                // Cloud sync wybranego avatara (best effort)
                if (cloudReady && cloudUser && cloudUser.profile) {
                    sb.from('profiles').update({ avatar: emoji }).eq('id', cloudUser.id).then(() => {
                        if (cloudUser && cloudUser.profile) cloudUser.profile.avatar = emoji;
                    }).catch(() => {});
                }
            });
        }
        // Wyszukiwarka
        const search = document.getElementById('avatar-search');
        if (search) {
            let timer;
            search.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => buildAvatarGrid(search.value), 150);
            });
        }
        buildAvatarGrid('');
    }

    /** Throttled hover handler — nie chcemy odtwarzac za kazdym
        mousemove, tylko raz na wjazd kursora na element (mouseenter). */
    function bindMissionAudioHooks() {
        const supportsHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        document.querySelectorAll('.btn-mode').forEach((btn) => {
            // Click sound ON CAPTURE phase — gra przed handlerem startGame
            // zeby uzytkownik uslyszal nawet jezeli ekran szybko sie zmieni.
            btn.addEventListener('pointerdown', () => playSound('click'));
            if (supportsHover) {
                btn.addEventListener('mouseenter', () => playSound('hover'));
            }
        });
    }

    function bindClickHandlers() {
        // EVENT DELEGATION na document — lapie klikniecia na WSZYSTKICH
        // elementach z [data-action], wlacznie z tymi tworzonymi dynamicznie
        // (sub-taby rankings, listy generated po fetch z chmury, itd.).
        document.addEventListener('click', (ev) => {
            const el = ev.target.closest('[data-action]');
            if (!el) return;
            const action = el.dataset.action;
            const arg = el.dataset.arg;
            // Wrapping w "ev" object zeby switch-case nizej dzialal bez zmian
            const handle = (ev) => {
                switch (action) {
                    case 'goToSetup': goToSetup(); break;
                    case 'showLeaderboard': showLeaderboard(); break;
                    case 'switchScreen': switchScreen(arg); break;
                    case 'toggleFullScreen': toggleFullScreen(); break;
                    case 'setDiff': setDiff(arg, el); break;
                    case 'startGame': startGame(arg); break;
                    case 'startGameSettings': startGame(settings.mode); break;
                    case 'backToSetup': backToSetup(); break;
                    case 'confirmExit': confirmExit(); break;
                    case 'switchTab': switchTab(arg, el); break;
                    case 'closeLeaderboard':
                        document.getElementById('modal-leaderboard').style.display = 'none';
                        break;
                    case 'closeReport': closeReport(); break;
                    case 'showHowto':
                        document.getElementById('modal-howto').style.display = 'flex';
                        break;
                    case 'closeHowto':
                        document.getElementById('modal-howto').style.display = 'none';
                        break;
                    case 'welcomeContinue': welcomeContinue(); break;
                    case 'welcomeChange': welcomeChange(); break;
                    case 'showSettings': showSettings(); break;
                    case 'closeSettings': closeSettings(); break;
                    case 'settingsTestSound': settingsTestSound(); break;
                    case 'settingsClearData': settingsClearData(); break;
                    case 'showAccount': showAccount(); break;
                    case 'closeAccount': closeAccount(); break;
                    case 'accountTab': accountTab(arg); break;
                    case 'accountSignUp': accountSignUp(); break;
                    case 'accountSignIn': accountSignIn(); break;
                    case 'accountSignOut': accountSignOut(); break;
                    case 'askLogoutLocal': askLogoutLocal(); break;
                    case 'askLogoutGlobal': askLogoutGlobal(); break;
                    case 'doLogoutConfirmed': doLogoutConfirmed(); break;
                    case 'cancelLogout': cancelLogout(); break;
                    case 'reloadPage': reloadPage(); break;
                    case 'accountSuggestName': accountSuggestName(); break;
                    case 'showEditProfile': showEditProfile(); break;
                    case 'closeEditProfile': closeEditProfile(); break;
                    case 'saveEditProfile': saveEditProfile(); break;
                    case 'topListTab': topListTab(arg); break;
                    case 'refreshProfileTopList': renderProfileTopList(); break;
                    case 'lbScope': lbScope(arg); break;
                    case 'lbFilter': lbFilter(arg); break;
                    case 'lbRankingKind': lbRankingKind(arg); break;
                    case 'showLesson':
                        ev.stopPropagation();
                        showLesson(arg);
                        break;
                    case 'closeLesson': closeLesson(); break;
                    case 'lessonStartGame': lessonStartGame(); break;
                    case 'closeReportSmart': {
                        // Archive view (came from leaderboard) -> back to leaderboard.
                        // Live view (just finished a game) -> close & go to setup.
                        const archiveBadge = document.getElementById('archive-badge');
                        const isArchive = archiveBadge && archiveBadge.style.display !== 'none';
                        if (isArchive) {
                            closeReport();
                        } else {
                            backToSetup();
                        }
                        break;
                    }
                    case 'toggleNavMenu': toggleNavMenu(); break;
                    case 'closeNavMenu': closeNavMenu(); break;
                    case 'nextFact': nextFact(false); break;
                }
                // Zamknij szufladę po kliknięciu przycisku nawigacyjnego wewnątrz niej
                if (['showLeaderboard','showAccount','showHowto','showSettings'].includes(action)) {
                    closeNavMenu();
                }
            };
            handle(ev);
        });
    }

    function toggleNavMenu() {
        const drawer = document.getElementById('nav-drawer');
        if (!drawer) return;
        const isOpen = drawer.classList.contains('is-open');
        if (isOpen) {
            closeNavMenu();
        } else {
            drawer.classList.add('is-open');
            const btn = document.querySelector('[data-action="toggleNavMenu"]');
            if (btn) btn.setAttribute('aria-expanded', 'true');
        }
    }

    function closeNavMenu() {
        const drawer = document.getElementById('nav-drawer');
        if (!drawer) return;
        drawer.classList.remove('is-open');
        const btn = document.querySelector('[data-action="toggleNavMenu"]');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function startQuoteRotation() {
        // Mix motivational quotes with math facts. Facts get a "💡 " prefix
        // so user can tell them apart from short cheers.
        const mixed = [
            ...quotes,
            ...mathFacts.map(f => `💡 ${f}`)
        ];
        let qIdx = Math.floor(Math.random() * quotes.length); // start from a quote
        setInterval(() => {
            qIdx = (qIdx + 1) % mixed.length;
            const el = document.getElementById("quote-display");
            if (!el) return;
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = '';
            el.textContent = mixed[qIdx];
        }, 5500);
    }

    /* ---------- Profile extras: Top-3 (Moje / Globalne) + math facts rotation ---------- */
    let profileTopMode = 'my'; // 'my' | 'global'

    let profileTopRenderToken = 0;

    async function renderProfileTopList() {
        const list = document.getElementById('profile-top-list');
        if (!list) return;
        // Zapobiega race condition gdy uzytkownik klika szybko miedzy tabami
        const token = ++profileTopRenderToken;
        list.innerHTML = '<li class="top-empty">⏳ Wczytuję wyniki...</li>';

        // Watchdog — jezeli za 5s nic, pokazujemy "spróbuj ponownie"
        const stuckTimer = setTimeout(() => {
            if (token !== profileTopRenderToken) return;
            list.innerHTML = '<li class="top-empty">⚠ Trwa to zbyt długo. <button class="top-retry-btn" data-action="refreshProfileTopList" type="button">Spróbuj ponownie</button></li>';
        }, 5500);

        let entries = [];
        if (profileTopMode === 'global' && cloudReady) {
            const cloud = await cloudFetchGlobalTop(3);
            if (token !== profileTopRenderToken) return;
            entries = cloud.map(c => ({ n: c.username, a: c.avatar, s: c.score, m: c.mode, diff: c.difficulty }));
        } else if (profileTopMode === 'my' && cloudUser && cloudUser._persistent && cloudReady) {
            // Zalogowany — ciągnij z cloud, TOP po score (to "Najlepsze wyniki", nie historia)
            const cloud = await cloudFetchMyResults(3, null, 'score');
            if (token !== profileTopRenderToken) return;
            entries = cloud.map(c => ({ n: cloudUser.profile && cloudUser.profile.username || user.name, a: cloudUser.profile && cloudUser.profile.avatar || user.avatar, s: c.score, m: c.mode, diff: c.difficulty }));
        } else {
            // Anon / brak chmury — local storage
            entries = loadLeaderboardData().slice(0, 3);
        }

        // Sukces — anuluj watchdog
        clearTimeout(stuckTimer);
        if (token !== profileTopRenderToken) return;

        if (!entries.length) {
            const msg = profileTopMode === 'global'
                ? 'Brak globalnych wyników jeszcze. Bądź pierwszy!'
                : 'Zagraj pierwszą misję, aby zobaczyć wyniki!';
            list.innerHTML = `<li class="top-empty">${msg}</li>`;
            return;
        }
        list.innerHTML = '';
        entries.forEach((entry, i) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="top-rank">#${i + 1}</span>
                <span class="top-name">
                    <span class="top-avatar">${escapeHtml(entry.a || '🦉')}</span>${escapeHtml(entry.n)}
                    <span class="top-meta">${getDiffName(entry.diff)} · ${getModeLabel(entry.m)}</span>
                </span>
                <span class="top-score">${entry.s}</span>
            `;
            list.appendChild(li);
        });
    }

    function topListTab(mode) {
        profileTopMode = mode;
        document.querySelectorAll('.qt-tab, .pd-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.arg === mode);
        });
        renderProfileTopList();
    }

    function startFactRotation() {
        let fIdx = Math.floor(Math.random() * mathFacts.length);
        const factEl = document.getElementById('math-fact');
        const counterEl = document.getElementById('fact-counter');
        if (!factEl) return;
        const updateFact = () => {
            factEl.style.animation = 'none';
            void factEl.offsetWidth;
            factEl.style.animation = '';
            factEl.textContent = mathFacts[fIdx];
            if (counterEl) counterEl.textContent = `${fIdx + 1} / ${mathFacts.length}`;
        };
        updateFact();
        setInterval(() => {
            fIdx = (fIdx + 1) % mathFacts.length;
            updateFact();
        }, 7000);
    }

    function init() {
        switchScreen('screen-profile');
        initBackgroundSymbols();
        initParticles();
        initHeroParallax();
        bindAvatarPicker();
        bindClickHandlers();
        bindMissionAudioHooks();
        startQuoteRotation();
        renderProfileTopList();
        renderWelcomeBack();
        installAudioUnlockGestureHooks();
        initCloud().then(() => {
            if (cloudReady) console.info('[cloud] connected as', cloudUser && cloudUser.id, cloudUser && cloudUser._persistent ? '(persistent)' : '(anonymous)');
            updateCloudStatusPill();
        });
        // Wstepny stan offline dopóki initCloud nie skończy
        updateCloudStatusPill();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ---------- Expose for inline onclick fallbacks ---------- */
    window.toggleFullScreen = toggleFullScreen;
    window.goToSetup = goToSetup;
    window.showLeaderboard = showLeaderboard;
    window.switchScreen = switchScreen;
    window.setDiff = setDiff;
    window.startGame = startGame;
    window.backToSetup = backToSetup;
    window.confirmExit = confirmExit;
    window.switchTab = switchTab;
    window.closeReport = closeReport;
})();
