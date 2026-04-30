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

            // Spróbuj pobrać aktualną sesję, jeśli nie ma — zaloguj anonimowo
            const { data: { session } } = await sb.auth.getSession();
            if (!session) {
                const { data, error } = await sb.auth.signInAnonymously();
                if (error) throw error;
            }
            const { data: { user: authUser } } = await sb.auth.getUser();
            if (!authUser) return;

            // Spróbuj wczytać profil
            const { data: profile } = await sb
                .from('profiles')
                .select('id, username, avatar, display_name')
                .eq('id', authUser.id)
                .maybeSingle();

            cloudUser = { id: authUser.id, profile };
            cloudReady = true;
        } catch (e) {
            console.warn('[cloud] init failed, going offline-only:', e && e.message);
            cloudReady = false;
        }
    }

    /** Próbuje zarezerwować nazwę gracza w chmurze. Zwraca true/false. */
    async function cloudClaimUsername(username, avatar) {
        if (!cloudReady) return false;
        try {
            const { data, error } = await sb.rpc('claim_username', {
                p_username: username,
                p_avatar: avatar,
                p_display_name: username
            });
            if (error) throw error;
            if (data === true) {
                cloudUser.profile = { username, avatar, display_name: username };
                return true;
            }
            return false;
        } catch (e) {
            console.warn('[cloud] claim failed:', e && e.message);
            return false;
        }
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
                history: result.history
            });
        } catch (e) {
            console.warn('[cloud] save failed:', e && e.message);
        }
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

    let html5Audios = null;
    function getHtml5Audio(type) {
        if (!html5Audios) {
            // Preferuj STATIC <audio> tagi z HTML — iOS lepiej je obsluguje
            // niz dynamicznie tworzone przez new Audio().
            const tagId = 'snd-' + type;
            const staticEl = document.getElementById(tagId);
            html5Audios = { c: null, w: null, lvl: null };
            ['c','w','lvl'].forEach(k => {
                const id = 'snd-' + k;
                let el = document.getElementById(id);
                if (!el) el = new Audio();
                el.src = buildSoundDataUri(k);
                el.preload = 'auto';
                el.playsInline = true;
                el.setAttribute('playsinline', '');
                el.setAttribute('webkit-playsinline', '');
                el.volume = 0.95;
                try { el.load(); } catch(_) {}
                html5Audios[k] = el;
            });
        }
        return html5Audios[type];
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
        - Na iOS: graj OBYDWA (WebAudio + HTML5) — daje 2x wieksza szanse
          ze cos zagra. iOS bywa kapryśne i czasem jedna metoda zadziala
          a druga nie.
        - Na desktop / Android: tylko WebAudio (najczystszy dzwiek). */
    function playSound(type) {
        const ios = isIOSDevice();

        // HTML5 Audio path
        if (ios) {
            playHtml5(type);
        }

        // WebAudio path
        const ctx = ensureAudioCtx();
        if (!ctx) {
            if (!ios) playHtml5(type); // non-ios fallback
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
            // "Touch" HTML5 audio elements w user-gesture context — iOS to zapamietuje.
            getHtml5Audio('c'); getHtml5Audio('w'); getHtml5Audio('lvl');
            ['c','w','lvl'].forEach(k => {
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
        timer.classList.toggle("is-urgent", remaining <= 10);
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
        startQuoteRotation();
        renderProfileTopList();
        renderWelcomeBack();
        installAudioUnlockGestureHooks();
        // Asynchroniczna inicjalizacja chmury — gra startuje natychmiast,
        // chmura jest "best effort". Jezeli sie powiedzie — bonus features.
        initCloud().then(() => {
            if (cloudReady) console.info('[cloud] connected as', cloudUser && cloudUser.id);
        });
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
