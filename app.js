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
        // V2 — szczegolowy raport
        try {
            const { data, error } = await sb.rpc('claim_username_v2', {
                p_username: username,
                p_avatar: avatar,
                p_display_name: username
            });
            if (!error && data && typeof data === 'object') {
                if (data.ok && cloudUser) {
                    cloudUser.profile = data.profile;
                }
                return data;
            }
            if (error && !/function .* does not exist/i.test(error.message || '')) {
                console.warn('[cloud] claim_username_v2 error:', error.message);
            }
        } catch (e) {
            console.warn('[cloud] claim_username_v2 threw:', e && e.message);
        }
        // Fallback do v1
        try {
            const { data, error } = await sb.rpc('claim_username', {
                p_username: username,
                p_avatar: avatar,
                p_display_name: username
            });
            if (error) throw error;
            if (data === true) {
                if (cloudUser) cloudUser.profile = { username, avatar, display_name: username };
                return { ok: true, profile: { username, avatar, display_name: username } };
            }
            return { ok: false, reason: 'taken_by_other' };
        } catch (e) {
            console.warn('[cloud] claim_username v1 failed:', e && e.message);
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

    async function cloudSaveResult(result) {
        if (!cloudReady || !cloudUser || !cloudUser.profile) return;
        try {
            const correct = result.history.filter(h => h.ok).length;
            const wrong = result.history.length - correct;
            const maxCombo = (() => {
                let m = 0, c = 0;
                for (const h of result.history) {
                    if (h.ok) { c++; if (c > m) m = c; } else c = 0;
                }
                return m;
            })();
            await sb.from('game_results').insert({
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
        } catch (e) {
            console.warn('[cloud] save failed:', e && e.message);
        }
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
    const namePartAdj = ['Sprytny','Mądry','Szybki','Dzielny','Bystry','Czujny','Silny','Wesoły','Dziarski','Odważny','Zwinny','Cierpliwy','Pewny','Czujny','Pilny','Lotny','Sprawny','Niezłomny','Rączy','Jasny'];
    const namePartNoun = ['Sowa','Lis','Tygrys','Smok','Panda','Jeleń','Ryś','Wilk','Wieloryb','Sokol','Kot','Pies','Konik','Niedźwiedź','Geniusz','Bohater','Wojownik','Mędrzec','Profesor','Mistrz'];

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

    async function cloudFetchGlobalTop(limit) {
        if (!cloudReady) return [];
        try {
            const { data, error } = await sb
                .from('leaderboard_global')
                .select('*')
                .limit(limit || 20);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[cloud] fetch top failed:', e && e.message);
            return [];
        }
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
                .select('id, username, avatar, display_name, email')
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

    /** Sign-up z verbose progress. onStep(text) opcjonalny callback do UI. */
    async function cloudSignUp(username, password, email, onStep) {
        const step = (text) => { if (onStep) onStep(text); };
        if (!cloudReady) throw new Error('Chmura niedostępna');
        const synth = syntheticEmailFor(username);

        step('Sprawdzam dostępność nazwy...');
        const checkRes = await cloudCheckUsername(username);
        if (checkRes === 'taken') {
            throw new Error(`Nazwa "${username}" jest już zajęta przez innego gracza`);
        }

        step('Sprawdzam stan sesji...');
        let { data: { user: current } } = await sb.auth.getUser();

        let resultUser;
        if (current && current.is_anonymous) {
            step('Aktualizuję anonimowe konto na trwałe (zachowuję wyniki)...');
            const { data, error } = await sb.auth.updateUser({ email: synth, password });
            if (error) {
                console.error('[cloud] updateUser error:', error);
                if (/email.*already/i.test(error.message)) {
                    throw new Error('Nazwa już ma konto. Użyj zakładki "Zaloguj się" zamiast "Stwórz konto".');
                }
                if (/confirm/i.test(error.message)) {
                    throw new Error('Konto wymaga potwierdzenia. Wyłącz "Confirm email" w Supabase Auth.');
                }
                throw new Error(error.message || 'Aktualizacja konta nie powiodła się');
            }
            resultUser = data && data.user;
            // Defensywnie sprawdź czy upgrade naprawdę przeszedł
            if (resultUser && resultUser.is_anonymous) {
                throw new Error('Konto wciąż jest anonimowe (Supabase ma włączone "Confirm email" dla zmian — wyłącz w Auth → Email).');
            }
        } else {
            step('Tworzę nowe konto...');
            const { data, error } = await sb.auth.signUp({ email: synth, password });
            if (error) {
                console.error('[cloud] signUp error:', error);
                if (/registered|exists/i.test(error.message)) {
                    throw new Error('Nazwa już ma konto. Użyj zakładki "Zaloguj się".');
                }
                throw new Error(error.message || 'Rejestracja nie powiodła się');
            }
            resultUser = data && data.user;
            if (!resultUser) {
                throw new Error('Konto utworzone, ale wymaga potwierdzenia. Wyłącz "Confirm email" w Supabase Auth → Email.');
            }
        }

        step('Odświeżam sesję...');
        await sb.auth.refreshSession().catch(() => {});

        step('Rezerwuję nazwę w bazie...');
        const claim = await cloudClaimUsername(username, user.avatar);
        if (!claim.ok) {
            const reason = claim.reason || 'unknown';
            const reasonText = {
                taken_by_other: `Nazwa "${username}" jest zajęta przez kogoś innego`,
                not_authenticated: 'Brak sesji — odśwież stronę i spróbuj ponownie',
                invalid_length: 'Nazwa musi mieć 2-20 znaków',
                invalid_chars: 'Nazwa może zawierać tylko litery, cyfry, _ i -',
                rpc_error: 'Błąd bazy: ' + (claim.detail || ''),
                no_cloud: 'Brak połączenia z chmurą'
            }[reason] || `Nie udało się zarezerwować nazwy (${reason})`;
            throw new Error(reasonText);
        }

        if (email && email.trim()) {
            step('Zapisuję adres email do odzyskiwania...');
            try {
                await sb.from('profiles')
                    .update({ email: email.trim().toLowerCase() })
                    .eq('id', resultUser.id);
            } catch (e) {
                console.warn('[cloud] email save failed:', e && e.message);
                // Nie blokujemy — email do recovery to "nice to have"
            }
        }

        step('Finalizuję...');
        await refreshCloudUser();
        return cloudUser;
    }

    async function cloudSignIn(username, password, onStep) {
        const step = (t) => { if (onStep) onStep(t); };
        if (!cloudReady) throw new Error('Chmura niedostępna');
        const synth = syntheticEmailFor(username);

        step('Wylogowuję poprzednią sesję...');
        try { await sb.auth.signOut(); } catch (_) {}

        step('Loguję na konto...');
        const { data, error } = await sb.auth.signInWithPassword({ email: synth, password });
        if (error) {
            console.error('[cloud] signIn error:', error);
            if (/Invalid login credentials|invalid_credentials/i.test(error.message)) {
                throw new Error('Nieprawidłowa nazwa lub hasło');
            }
            if (/Email not confirmed/i.test(error.message)) {
                throw new Error('Konto nie zostało potwierdzone. Wyłącz "Confirm email" w Supabase Auth → Email.');
            }
            throw new Error(error.message || 'Logowanie nieudane');
        }

        step('Pobieram profil...');
        await refreshCloudUser();
        if (cloudUser && cloudUser.profile) {
            user.name = cloudUser.profile.username;
            user.avatar = cloudUser.profile.avatar || user.avatar;
        } else {
            throw new Error('Zalogowano ale brak profilu (sprawdź czy migracja 0001 została zastosowana)');
        }
        return cloudUser;
    }

    async function cloudSignOut() {
        if (!cloudReady) return;
        try { await sb.auth.signOut(); } catch (_) {}
        // Stworz nowa anonimowa sesje zeby gra dalej dzialala
        try {
            await sb.auth.signInAnonymously();
            await refreshCloudUser();
        } catch (_) {}
    }

    /** Aktualizuje wskaznik chmury w UI. */
    function updateCloudStatusPill() {
        const pill = document.getElementById('cloud-status-pill');
        const label = document.getElementById('cloud-status-label');
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

    const confettiColors = ["#0F766E", "#3730A3", "#D97706", "#0EA5E9", "#10B981", "#F59E0B"];
    const mathSymbols = ["+", "−", "×", "÷", "=", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "π", "√", "%"];

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

        // Jezeli juz zalogowany trwale — pokaz info + przycisk Wyloguj
        const signupTab = document.getElementById('acc-tab-signup');
        const signupInfo = document.getElementById('acc-signup-info');
        if (cloudUser && cloudUser._persistent && cloudUser.profile && signupInfo) {
            signupInfo.innerHTML = `
                ✓ Jesteś zalogowany jako <strong>${escapeHtml(cloudUser.profile.username)}</strong>.
                Twoje wyniki synchronizują się z chmurą.
                <br><br>
                <button class="btn-big btn-secondary" type="button" data-action="accountSignOut">Wyloguj się</button>
            `;
            // Podepnij handler do tego przycisku
            const btn = signupInfo.querySelector('button');
            if (btn) btn.addEventListener('click', accountSignOut);
        } else if (signupInfo && cloudReady) {
            signupInfo.innerHTML = 'Zachowamy Twoje dotychczasowe wyniki i powiążemy je z trwałym kontem. Dzięki temu możesz grać na innych urządzeniach i rywalizować w globalnym rankingu.';
        } else if (signupInfo) {
            signupInfo.innerHTML = '⚠️ Brak połączenia z chmurą — funkcja kont chwilowo niedostępna.';
        }

        // Prefill nazwy z formularza profilu
        const nameInput = document.getElementById('acc-signup-name');
        const profileInput = document.getElementById('username');
        if (nameInput && profileInput && profileInput.value) {
            nameInput.value = profileInput.value;
        }

        accountTab('signup');
        modal.style.display = 'flex';
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
            setTimeout(() => closeAccount(), 1500);
        } catch (e) {
            console.error('[signup] failed:', e);
            setAccStatus('acc-signup-status', '⚠ ' + (e.message || 'Nie udało się stworzyć konta'), 'bad');
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
            setTimeout(() => closeAccount(), 1500);
        } catch (e) {
            setAccStatus('acc-signin-status', '⚠ ' + (e.message || 'Logowanie nieudane'), 'bad');
        }
    }

    async function accountSignOut() {
        if (!confirm('Wylogować się? Wrócisz do trybu anonimowego — wyniki nadal będą synchronizować się z chmurą, ale nie będą widoczne na innych urządzeniach.')) return;
        try {
            await cloudSignOut();
            updateCloudStatusPill();
            renderWelcomeBack();
            closeAccount();
        } catch (e) {
            alert('Nie udało się wylogować: ' + (e.message || ''));
        }
    }

    function settingsClearData() {
        const status = document.getElementById('settings-clear-status');
        if (!confirm('Na pewno usunąć wszystkie wyniki i zapamiętany profil?')) return;
        try {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(legacyStorageKey);
            localStorage.removeItem(lastUserKey);
            if (status) {
                status.textContent = '✓ Wszystkie dane usunięte';
                status.classList.add('is-good');
            }
            // Refresh affected widgets
            renderProfileTopList();
            renderWelcomeBack();
        } catch (e) {
            if (status) {
                status.textContent = '⚠ Błąd: ' + (e.message || 'nie można wyczyścić');
                status.classList.add('is-bad');
            }
        }
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
        const typedName = document.getElementById("username").value.trim();
        if (typedName) user.name = typedName;
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
        const last = loadLastUser();
        if (!banner) return;
        if (!last) {
            banner.style.display = 'none';
            return;
        }
        document.getElementById('welcome-avatar').textContent = last.avatar;
        document.getElementById('welcome-name').textContent = `Witaj, ${last.name}!`;
        document.getElementById('welcome-meta').textContent = `Ostatnia gra: ${formatRelativeTime(last.ts)}`;
        banner.style.display = 'flex';
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

    function welcomeChange() {
        const banner = document.getElementById('welcome-back');
        if (banner) banner.style.display = 'none';
        // Scroll user to the form so they can change name/avatar
        const form = document.querySelector('.profile-form-card');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    function showLeaderboard() {
        const container = document.getElementById("leaderboard-content");
        container.innerHTML = "";
        const data = loadLeaderboardData();

        if (!data.length) {
            container.innerHTML = '<p class="muted-empty">Brak zapisanych wyników. Zagraj pierwszą misję.</p>';
        } else {
            const list = document.createElement("div");
            list.className = "leaderboard-list";

            data.forEach((entry, index) => {
                const row = document.createElement("button");
                row.type = "button";
                row.className = "leaderboard-entry";
                row.onclick = () => loadArchive(index);

                row.innerHTML = `
                    <div class="leaderboard-top">
                        <div class="leaderboard-player">
                            <div class="leaderboard-rank">${index + 1}</div>
                            <div>
                                <div class="leaderboard-name">${escapeHtml(entry.a)} ${escapeHtml(entry.n)}</div>
                                <div class="leaderboard-meta">${getDiffName(entry.diff)} · ${entry.t === 0 ? "Trening" : `${entry.t} min`} · ${getModeLabel(entry.m)}</div>
                            </div>
                        </div>
                        <div class="leaderboard-score">${entry.s}</div>
                    </div>
                    <div class="leaderboard-meta">${entry.d}</div>
                `;

                list.appendChild(row);
            });

            container.appendChild(list);
        }

        document.getElementById("modal-leaderboard").style.display = "flex";
    }

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
    function bindAvatarPicker() {
        document.querySelectorAll(".avatar-option").forEach((el) => {
            el.addEventListener("click", function () {
                document.querySelectorAll(".avatar-option").forEach((a) => a.classList.remove("selected"));
                this.classList.add("selected");
                user.avatar = this.textContent.trim();
            });
        });
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
        document.querySelectorAll('[data-action]').forEach((el) => {
            const action = el.dataset.action;
            const arg = el.dataset.arg;
            el.addEventListener('click', (ev) => {
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
                    case 'accountSuggestName': accountSuggestName(); break;
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
                }
            });
        });
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

    /* ---------- Profile extras: Top-3 mini-leaderboard + math facts rotation ---------- */
    function renderProfileTopList() {
        const list = document.getElementById('profile-top-list');
        if (!list) return;
        const data = loadLeaderboardData();
        if (!data.length) {
            list.innerHTML = '<li class="top-empty">Zagraj pierwszą misję, aby zobaczyć wyniki!</li>';
            return;
        }
        list.innerHTML = '';
        data.slice(0, 3).forEach((entry, i) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="top-rank">#${i + 1}</span>
                <span class="top-name">
                    <span class="top-avatar">${escapeHtml(entry.a)}</span>${escapeHtml(entry.n)}
                    <span class="top-meta">${getDiffName(entry.diff)} · ${getModeLabel(entry.m)}</span>
                </span>
                <span class="top-score">${entry.s}</span>
            `;
            list.appendChild(li);
        });
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
