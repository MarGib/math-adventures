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
    const audioCtx = AudioContextCtor ? new AudioContextCtor() : null;

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
       AUDIO — z poprawnym iOS WebKit unlock
       ============================================================
       Problem na iOS: AudioContext startuje w stanie 'suspended',
       resume() dziala TYLKO z handlera user-gesture, oraz oscillator
       musi byc tworzony PO zakonczeniu resume() (nie synchronicznie).
       Dodatkowo iOS potrzebuje "warm-up" silent buffer aby w pelni
       odblokowac audio. Bez tego dzwieki nie graja w Safari/Vivaldi
       /Chrome na iPhone (wszystkie uzywaja WebKit). */
    let audioUnlocked = false;
    let audioUnlockPromise = null;

    function unlockAudio() {
        if (!audioCtx) return Promise.resolve();
        if (audioUnlocked) return Promise.resolve();
        if (audioUnlockPromise) return audioUnlockPromise;

        const doUnlock = () => {
            // Silent 1-sample buffer — iOS wymaga zeby "rozgrzac" context.
            try {
                const buffer = audioCtx.createBuffer(1, 1, 22050);
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(audioCtx.destination);
                source.start(0);
            } catch (_) { /* ignore */ }
            audioUnlocked = true;
        };

        if (audioCtx.state === 'suspended') {
            audioUnlockPromise = audioCtx.resume().then(doUnlock).catch(() => {});
        } else {
            doUnlock();
            audioUnlockPromise = Promise.resolve();
        }
        return audioUnlockPromise;
    }

    /** Attach unlock to first user gesture — niezawodna metoda na iOS. */
    function installAudioUnlockGestureHooks() {
        if (!audioCtx) return;
        const events = ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'];
        const handler = () => {
            unlockAudio();
            // Po pierwszym sukcesie odpinamy listenery zeby nie marnowac CPU.
            if (audioUnlocked) {
                events.forEach(evt => document.removeEventListener(evt, handler));
            }
        };
        events.forEach(evt => document.addEventListener(evt, handler, { passive: true }));
    }

    function playSound(type) {
        if (!audioCtx) return;

        const doPlay = () => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            const now = audioCtx.currentTime;

            if (type === "c") {
                osc.frequency.setValueAtTime(500, now);
                osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
                gain.gain.setValueAtTime(0.22, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
                osc.start();
                osc.stop(now + 0.25);
            } else if (type === "w") {
                osc.type = "sawtooth";
                osc.frequency.setValueAtTime(150, now);
                osc.frequency.linearRampToValueAtTime(100, now + 0.25);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
                osc.start();
                osc.stop(now + 0.25);
            } else if (type === "lvl") {
                osc.type = "triangle";
                osc.frequency.setValueAtTime(420, now);
                osc.frequency.setValueAtTime(620, now + 0.1);
                osc.frequency.setValueAtTime(840, now + 0.2);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.linearRampToValueAtTime(0.01, now + 0.45);
                osc.start();
                osc.stop(now + 0.45);
            }
        };

        // CRITICAL na iOS: jezeli context jeszcze suspended, najpierw resume,
        // PO zakonczeniu twórz oscillator. Synchroniczne wywolanie nie zagra.
        if (audioCtx.state === 'suspended') {
            unlockAudio().then(() => {
                if (audioCtx.state === 'running') doPlay();
            });
        } else {
            doPlay();
        }
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
        gameState = { score: 0, history: [], timerInterval: null, endTime: 0, active: true, combo: 0 };

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

    function nextQuestion() {
        if (!gameState.active) return;

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

        gameState.currentQ = { text: `${a} ${symbol} ${b}`, correct, start: Date.now() };

        const qBox = document.getElementById("question-text");
        qBox.classList.remove('question-out');
        // restart questionIn anim
        qBox.style.animation = 'none';
        void qBox.offsetWidth;
        qBox.style.animation = '';
        qBox.textContent = `${a} ${symbol} ${b} = ?`;
        renderOptions(buildOptions(correct, mode));
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
