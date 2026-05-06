(function () {
    'use strict';
    const ADDON          = 'TrackFollow';
    const SLOTS          = 5;
    const LS_KEY         = 'cpv_slots';
    const LS_ACTIVE      = 'cpv_active';
    const WRAP_ID        = 'cpv-slots-wrap';
    const NATIVE_BTN_SEL = '[class*="CustomPlayerThumbSelector_button"]';
    const LOG = (...a) => console.log('[TrackFollow]', ...a);

    function loadSlots() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return Array(SLOTS).fill(null);
            const arr = JSON.parse(raw);
            while (arr.length < SLOTS) arr.push(null);
            return arr.slice(0, SLOTS);
        } catch (_) { return Array(SLOTS).fill(null); }
    }
    function saveSlots(s)  { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {} }
    function loadActive()  {
        try {
            const v = parseInt(localStorage.getItem(LS_ACTIVE) ?? '-1', 10);
            return (v >= 0 && v < SLOTS) ? v : -1;
        } catch (_) { return -1; }
    }
    function saveActive(i) { try { localStorage.setItem(LS_ACTIVE, String(i)); } catch (_) {} }

    let slots  = loadSlots();
    let active = loadActive();

    let spriteSize       = 48;
    let offsetX          = 0;
    let offsetY          = 0;
    let lerpSpeed        = 0.18;
    let hideInFullscreen = true;

    let spriteEl        = null;
    let timecodeWrap    = null;
    let rafId           = null;
    let currentLeft     = null;
    let targetLeft      = null;
    let lastKnownTarget = null;

    // ── Проверка fullscreen ──────────────────────────────────────
    function isFullscreen() {
        if (document.fullscreenElement) return true;
        if (document.body.hasAttribute('data-scroll-locked')) return true;
        return false;
    }

    function getSpriteVisibility() {
        if (hideInFullscreen && isFullscreen()) return 'hidden';
        return 'visible';
    }

    new MutationObserver(() => {
        if (spriteEl) spriteEl.style.visibility = getSpriteVisibility();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked'] });

    document.addEventListener('fullscreenchange', () => {
        if (spriteEl) spriteEl.style.visibility = getSpriteVisibility();
    });

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
            position: 'absolute', transform: 'translateX(-50%)',
            pointerEvents: 'none', zIndex: '2147483647',
            visibility: 'hidden',
        });
        bar.appendChild(spriteEl);
        LOG('спрайт вставлен');
    }

    function unmountSprite() {
        if (spriteEl) { spriteEl.remove(); spriteEl = null; }
        if (rafId)    { cancelAnimationFrame(rafId); rafId = null; }
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
        currentLeft += (targetLeft - currentLeft) * lerpSpeed;
        spriteEl.style.left       = currentLeft + 'px';
        spriteEl.style.visibility = getSpriteVisibility();
        const top = calcTop();
        if (top !== null) spriteEl.style.top = top + 'px';
        schedTick();
    }
    function schedTick() { rafId = requestAnimationFrame(tickSprite); }

    function startSprite() {
        unmountSprite();
        if (active < 0 || !slots[active]) return;
        function tryMount() { mountSprite(); if (!spriteEl) { setTimeout(tryMount, 300); return; } schedTick(); }
        tryMount();
    }
    function updateSpriteStyle() {
        if (!spriteEl) return;
        spriteEl.style.width  = spriteSize + 'px';
        spriteEl.style.height = spriteSize + 'px';
    }

    // ── Карточки ─────────────────────────────────────────────
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
            slots[idx] = null; saveSlots(slots);
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
                slots[slotIdx] = e.target.result; saveSlots(slots);
                active = slotIdx; saveActive(slotIdx);
                startSprite(); renderAllCards();
            };
            reader.onerror = () => LOG('ошибка чтения');
            reader.readAsDataURL(file);
        });
        input.click();
    }

    function applySettings(s) {
        const sz = parseInt(s?.spriteSize?.value ?? 48, 10);
        if (sz >= 1) spriteSize = sz;
        offsetX = parseInt(s?.offsetX?.value ?? 100, 10) - 100;
        offsetY = parseInt(s?.offsetY?.value ?? 100, 10) - 100;
        const ls = parseInt(s?.lerpSpeed?.value ?? 18, 10);
        lerpSpeed = Math.max(0.01, Math.min(1.0, ls / 100));
        hideInFullscreen = parseInt(s?.hideInFullscreen?.value ?? 1, 10) === 1;
        updateSpriteStyle();
        if (spriteEl) spriteEl.style.visibility = getSpriteVisibility();
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
