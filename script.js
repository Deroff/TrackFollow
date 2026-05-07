(function () {
    'use strict';
    const ADDON          = 'TrackFollow';
    const SLOTS          = 5;
    const LS_SLOT        = i => `cpv_slot_${i}`;
    const LS_ACTIVE      = 'cpv_active';
    const LS_OLD_KEY     = 'cpv_slots';
    const WRAP_ID        = 'cpv-slots-wrap';
    const NATIVE_BTN_SEL = '[class*="CustomPlayerThumbSelector_button"]';
    const LOG = (...a) => console.log('[TrackFollow]', ...a);

    function migrateIfNeeded() {
        try {
            const anyNew = Array.from({length: SLOTS}, (_, i) => localStorage.getItem(LS_SLOT(i))).some(Boolean);
            if (anyNew) return;
            const raw = localStorage.getItem(LS_OLD_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            arr.forEach((dataUrl, i) => {
                if (i < SLOTS && dataUrl) {
                    try { localStorage.setItem(LS_SLOT(i), dataUrl); } catch (_) {}
                }
            });
            localStorage.removeItem(LS_OLD_KEY);
            LOG('мигрировали слоты из cpv_slots');
        } catch (_) {}
    }

    function loadSlots() {
        const arr = [];
        for (let i = 0; i < SLOTS; i++) {
            try { arr.push(localStorage.getItem(LS_SLOT(i)) || null); }
            catch (_) { arr.push(null); }
        }
        return arr;
    }
    function saveSlot(i, dataUrl) {
        try {
            if (dataUrl) localStorage.setItem(LS_SLOT(i), dataUrl);
            else         localStorage.removeItem(LS_SLOT(i));
        } catch (e) {
            LOG(`ошибка сохранения слота ${i}:`, e.name);
        }
    }
    function loadActive()  {
        try {
            const v = parseInt(localStorage.getItem(LS_ACTIVE) ?? '-1', 10);
            return (v >= 0 && v < SLOTS) ? v : -1;
        } catch (_) { return -1; }
    }
    function saveActive(i) { try { localStorage.setItem(LS_ACTIVE, String(i)); } catch (_) {} }

    migrateIfNeeded();
    let slots  = loadSlots();
    let active = loadActive();

    let spriteSize        = 48;
    let offsetX           = 0;
    let offsetY           = 0;
    let lerpSpeed         = 0.18;
    let hideInFullscreen  = true;
    let pauseGif          = true;
    let mirrorStatic      = false;
    let mirrorByDirection = false;

    let spriteEl        = null;
    let canvasEl        = null;
    let timecodeWrap    = null;
    let rafId           = null;
    let currentLeft     = null;
    let targetLeft      = null;
    let lastKnownTarget = null;
    let lastDirection   = 1;
    let wasPlaying      = true;
    let playPollId      = null;

    function isFullscreen() {
        if (document.fullscreenElement) return true;
        if (document.body.hasAttribute('data-scroll-locked')) return true;
        return false;
    }

    function isSplashVisible() {
        const splash = document.querySelector('[class*="SplashScreen_root"]');
        if (!splash) return false;
        return !splash.className.includes('hidden');
    }

    function getSpriteVisibility() {
        if (isSplashVisible()) return 'hidden';
        if (hideInFullscreen && isFullscreen()) return 'hidden';
        return 'visible';
    }

    // Обновляет visibility у spriteEl и canvasEl сразу
    function syncVisibility() {
        const vis = getSpriteVisibility();
        if (spriteEl) spriteEl.style.visibility = vis;
        if (canvasEl) canvasEl.style.visibility = vis;
    }

    new MutationObserver(syncVisibility)
        .observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'data-scroll-locked'] });

    document.addEventListener('fullscreenchange', syncVisibility);

    function getTimecodeWrap() {
        if (timecodeWrap && document.contains(timecodeWrap)) return timecodeWrap;
        timecodeWrap = document.querySelector('[data-test-id="TIMECODE_WRAPPER"]');
        return timecodeWrap;
    }
    function getPlayerBar() {
        return document.querySelector('[class*="PlayerBar_root"]')
            ?? document.querySelector('[class*="PlayerBar"]')
            ?? document.querySelector('[data-test-id="PLAYER_BAR"]');
    }
    function calcTargetLeft() {
        const wrap = getTimecodeWrap(), bar = getPlayerBar();
        if (!wrap || !bar) return null;
        const thumbPx = parseFloat(getComputedStyle(wrap).getPropertyValue('--thumb-position'));
        if (isNaN(thumbPx)) return null;
        return (wrap.getBoundingClientRect().left - bar.getBoundingClientRect().left) + thumbPx + offsetX;
    }
    function calcTop() {
        const wrap = getTimecodeWrap(), bar = getPlayerBar();
        if (!wrap || !bar) return null;
        return (wrap.getBoundingClientRect().top - bar.getBoundingClientRect().top) - spriteSize / 2 + offsetY;
    }

    function getSpriteTransform(dir) {
        const flip = mirrorStatic ? -1 : 1;
        const d    = mirrorByDirection ? dir : 1;
        return `translateX(-50%) scaleX(${flip * d})`;
    }

    // Применяет позицию к элементу (img или canvas)
    function applyPos(el, left, top, transform, vis) {
        el.style.left       = left + 'px';
        el.style.transform  = transform;
        el.style.visibility = vis;
        if (top !== null) el.style.top = top + 'px';
    }

    function freezeFrame() {
        if (!spriteEl || !canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        canvasEl.width  = spriteSize;
        canvasEl.height = spriteSize;
        ctx.drawImage(spriteEl, 0, 0, spriteSize, spriteSize);
        canvasEl.style.cssText = spriteEl.style.cssText;
        canvasEl.style.display = '';
        spriteEl.style.display = 'none';
    }

    function unfreezeFrame() {
        if (!spriteEl || !canvasEl) return;
        spriteEl.style.display = '';
        canvasEl.style.display = 'none';
    }

    function startPlayPoll() {
        if (playPollId) return;
        playPollId = setInterval(() => {
            if (!window.pulsesyncApi) return;
            const playing = window.pulsesyncApi.isPlaying();
            if (playing === wasPlaying) return;
            wasPlaying = playing;
            if (!pauseGif) return;
            if (playing) unfreezeFrame();
            else         freezeFrame();
        }, 100);
    }
    function stopPlayPoll() {
        if (playPollId) { clearInterval(playPollId); playPollId = null; }
    }

    function mountSprite() {
        if (spriteEl && document.contains(spriteEl)) return;
        const dataUrl = active >= 0 ? slots[active] : null;
        if (!dataUrl || !getTimecodeWrap()) { unmountSprite(); return; }
        const bar = getPlayerBar();
        if (!bar) return;
        if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';

        spriteEl = document.createElement('img');
        spriteEl.id  = 'cpv-sprite';
        spriteEl.src = dataUrl;
        Object.assign(spriteEl.style, {
            width: spriteSize + 'px', height: spriteSize + 'px',
            position: 'absolute', transform: getSpriteTransform(lastDirection),
            pointerEvents: 'none', zIndex: '2147483647',
            visibility: 'hidden',
        });

        canvasEl = document.createElement('canvas');
        canvasEl.id = 'cpv-sprite-canvas';
        Object.assign(canvasEl.style, {
            width: spriteSize + 'px', height: spriteSize + 'px',
            position: 'absolute', transform: getSpriteTransform(lastDirection),
            pointerEvents: 'none', zIndex: '2147483647',
            visibility: 'hidden', display: 'none',
        });

        bar.appendChild(spriteEl);
        bar.appendChild(canvasEl);
        LOG('спрайт вставлен');

        if (pauseGif && !wasPlaying) {
            spriteEl.onload = () => { freezeFrame(); spriteEl.onload = null; };
        }
    }

    function unmountSprite() {
        if (spriteEl) { spriteEl.remove(); spriteEl = null; }
        if (canvasEl) { canvasEl.remove(); canvasEl = null; }
        if (rafId)    { cancelAnimationFrame(rafId); rafId = null; }
        stopPlayPoll();
        currentLeft = null; targetLeft = null;
    }

    function tickSprite() {
        rafId = null;
        if (!spriteEl || !document.contains(spriteEl)) {
            mountSprite();
            if (!spriteEl) { schedTick(); return; }
        }
        const newTarget = calcTargetLeft();
        if (newTarget !== null) {
            targetLeft = newTarget;
            if (currentLeft === null)
                currentLeft = (lastKnownTarget !== null) ? lastKnownTarget : newTarget;
            lastKnownTarget = newTarget;
        }
        if (currentLeft === null) { schedTick(); return; }

        const diff = targetLeft - currentLeft;
        if (Math.abs(diff) > 0.5) lastDirection = diff > 0 ? 1 : -1;

        currentLeft += diff * lerpSpeed;
        const transform = getSpriteTransform(lastDirection);
        const top       = calcTop();
        const vis       = getSpriteVisibility();

        applyPos(spriteEl, currentLeft, top, transform, vis);
        if (canvasEl && canvasEl.style.display !== 'none')
            applyPos(canvasEl, currentLeft, top, transform, vis);

        schedTick();
    }
    function schedTick() { rafId = requestAnimationFrame(tickSprite); }

    function startSprite() {
        unmountSprite();
        if (active < 0 || !slots[active]) return;
        wasPlaying = true;
        function tryMount() {
            mountSprite();
            if (!spriteEl) { setTimeout(tryMount, 300); return; }
            schedTick();
            startPlayPoll();
        }
        tryMount();
    }
    function updateSpriteStyle() {
        if (!spriteEl) return;
        spriteEl.style.width  = spriteSize + 'px';
        spriteEl.style.height = spriteSize + 'px';
        if (canvasEl) {
            canvasEl.style.width  = spriteSize + 'px';
            canvasEl.style.height = spriteSize + 'px';
        }
    }

    function renderCard(idx) {
        const card = document.querySelector(`[data-cpv-slot="${idx}"]`);
        if (!card) return;
        const dataUrl  = slots[idx];
        const isActive = idx === active;
        card.classList.toggle('cpv-has-image', !!dataUrl);
        card.classList.toggle('cpv-active', isActive);
        const thumb = card.querySelector('.cpv-thumb');
        if (thumb) thumb.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : '';
        const icon  = card.querySelector('.cpv-upload-icon');
        const label = card.querySelector('.cpv-upload-label');
        if (icon)  icon.style.display = dataUrl ? 'none' : '';
        if (label) label.textContent  = dataUrl
            ? (isActive ? '✅ Активный' : 'Активировать')
            : 'Добавить';
    }
    function renderAllCards() { for (let i = 0; i < SLOTS; i++) renderCard(i); }

    function createCard(idx) {
        const card = document.createElement('div');
        card.className = 'cpv-upload-card';
        card.dataset.cpvSlot = String(idx);
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'cpv-thumb-wrap';
        const thumb = document.createElement('div');
        thumb.className = 'cpv-thumb';
        const icon = document.createElement('span');
        icon.className = 'cpv-upload-icon';
        icon.textContent = '＋';
        thumbWrap.append(thumb, icon);
        const label = document.createElement('span');
        label.className = 'cpv-upload-label';
        label.textContent = 'Добавить';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'cpv-remove-btn';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Удалить';
        removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            slots[idx] = null;
            saveSlot(idx, null);
            if (active === idx) { active = -1; saveActive(-1); unmountSprite(); }
            renderCard(idx);
        });
        card.append(thumbWrap, label, removeBtn);
        card.addEventListener('click', e => {
            if (e.target === removeBtn) return;
            if (slots[idx]) {
                if (active === idx) { active = -1; saveActive(-1); unmountSprite(); }
                else               { active = idx; saveActive(idx); startSprite(); }
                renderAllCards();
            } else { openFilePicker(idx); }
        });
        return card;
    }

    let injectScheduled = false;
    function tryInjectCards() {
        if (document.getElementById(WRAP_ID)) return;
        if (injectScheduled) return;
        injectScheduled = true;
        setTimeout(() => {
            injectScheduled = false;
            if (document.getElementById(WRAP_ID)) return;
            const btn = document.querySelector(NATIVE_BTN_SEL);
            if (!btn) return;
            const nativeContainer = btn.parentElement;
            const wrap = document.createElement('div');
            wrap.id = WRAP_ID;
            const cs = getComputedStyle(nativeContainer);
            wrap.style.cssText = [
                `display:${cs.display || 'flex'}`,
                `flex-wrap:${cs.flexWrap || 'wrap'}`,
                `gap:${cs.gap || '8px'}`,
                'margin-bottom:8px',
            ].join(';');
            for (let i = 0; i < SLOTS; i++) wrap.appendChild(createCard(i));
            nativeContainer.parentElement.insertBefore(wrap, nativeContainer);
            setTimeout(renderAllCards, 0);
            LOG('слоты вставлены');
        }, 0);
    }

    function openFilePicker(slotIdx) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
            const file = input.files?.[0]; input.remove();
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { alert('[TrackFollow] Файл слишком большой (макс. 5 МБ).'); return; }
            const reader = new FileReader();
            reader.onload = e => {
                slots[slotIdx] = e.target.result;
                saveSlot(slotIdx, e.target.result);
                active = slotIdx; saveActive(slotIdx);
                startSprite(); renderAllCards();
            };
            reader.onerror = () => LOG('ошибка чтения');
            reader.readAsDataURL(file);
        });
        input.click();
    }

    function asBool(setting, fallback) {
        if (!setting) return fallback;
        if (typeof setting.value === 'boolean') return setting.value;
        if (setting.value !== undefined) return parseInt(setting.value, 10) === 1;
        return fallback;
    }

    function applySettings(s) {
        const sz = parseInt(s?.spriteSize?.value ?? 48, 10);
        if (sz >= 1) spriteSize = sz;
        offsetX = parseInt(s?.offsetX?.value ?? 100, 10) - 100;
        offsetY = parseInt(s?.offsetY?.value ?? 100, 10) - 100;
        const ls = parseInt(s?.lerpSpeed?.value ?? 18, 10);
        lerpSpeed = Math.max(0.01, Math.min(1.0, ls / 100));

        hideInFullscreen  = asBool(s?.hideInFullscreen,  true);
        pauseGif          = asBool(s?.pauseGif,          true);
        mirrorStatic      = asBool(s?.mirrorStatic,      false);
        mirrorByDirection = asBool(s?.mirrorByDirection, false);

        if (!pauseGif && canvasEl && canvasEl.style.display !== 'none') {
            unfreezeFrame();
        }
        if (pauseGif && !wasPlaying) {
            freezeFrame();
        }

        updateSpriteStyle();
        if (spriteEl) {
            spriteEl.style.visibility = getSpriteVisibility();
            spriteEl.style.transform  = getSpriteTransform(lastDirection);
        }
        if (canvasEl && canvasEl.style.display !== 'none') {
            canvasEl.style.visibility = getSpriteVisibility();
            canvasEl.style.transform  = getSpriteTransform(lastDirection);
        }
    }
    function initSettings() {
        if (!window.pulsesyncApi) { setTimeout(initSettings, 300); return; }
        const mgr = window.pulsesyncApi.getSettings(ADDON);
        function tryHydrate() {
            const s = mgr.getCurrent();
            if (!s || Object.keys(s).length === 0) { setTimeout(tryHydrate, 200); return; }
            applySettings(s); startSprite();
        }
        tryHydrate();
        mgr.onChange(s => applySettings(s));
    }

    new MutationObserver(tryInjectCards)
        .observe(document.body, { childList: true, subtree: true });

    initSettings();
})();
