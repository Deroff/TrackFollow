(function () {
    'use strict';
    const ADDON          = 'TrackFollow';
    const LS_SLOT        = i => `cpv_slot_${i}`;
    const LS_SLOT_PAUSE  = i => `cpv_slot_pause_${i}`;
    const LS_ACTIVE      = 'cpv_active';
    const LS_COUNT       = 'cpv_slots_count';
    const LS_OLD_KEY     = 'cpv_slots';
    const DEFAULT_SLOTS  = 5;
    const MAX_SLOTS      = 12;
    const WRAP_ID        = 'cpv-slots-wrap';
    const NATIVE_BTN_SEL = '[class*="CustomPlayerThumbSelector_button"]';
    const FS_ROOT_SEL    = '[class*="FullscreenPlayerDesktopContent_root"]';
    const FS_CLOSE_BTN_SEL = '[data-test-id="FULLSCREEN_PLAYER_CLOSE_BUTTON"]';
    const LOG = (...a) => console.log('[TrackFollow]', ...a);

    const blobCache      = [];
    const blobCachePause = [];

    function base64ToBlob(dataUrl) {
        const [header, b64] = dataUrl.split(',');
        const mime = header.match(/:(.*?);/)[1];
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    function setBlobCache(idx, dataUrl) {
        if (blobCache[idx]) { URL.revokeObjectURL(blobCache[idx]); blobCache[idx] = null; }
        if (dataUrl) blobCache[idx] = URL.createObjectURL(base64ToBlob(dataUrl));
    }
    function setBlobCachePause(idx, dataUrl) {
        if (blobCachePause[idx]) { URL.revokeObjectURL(blobCachePause[idx]); blobCachePause[idx] = null; }
        if (dataUrl) blobCachePause[idx] = URL.createObjectURL(base64ToBlob(dataUrl));
    }

    function shiftBlobCache(fromIdx) {
        for (let i = fromIdx; i < slotsCount - 1; i++) {
            blobCache[i]      = blobCache[i + 1];
            blobCachePause[i] = blobCachePause[i + 1];
        }
        blobCache[slotsCount - 1]      = null;
        blobCachePause[slotsCount - 1] = null;
    }

    function getBlobUrl(idx)      { return blobCache[idx]      || null; }
    function getBlobUrlPause(idx) { return blobCachePause[idx] || null; }

    function loadSlotsCount() {
        try {
            const v = parseInt(localStorage.getItem(LS_COUNT) ?? DEFAULT_SLOTS, 10);
            return (v >= 1 && v <= MAX_SLOTS) ? v : DEFAULT_SLOTS;
        } catch (_) { return DEFAULT_SLOTS; }
    }
    function saveSlotsCount(n) {
        try { localStorage.setItem(LS_COUNT, String(n)); } catch (_) {}
    }

    function migrateIfNeeded(count) {
        try {
            const anyNew = Array.from({length: count}, (_, i) => localStorage.getItem(LS_SLOT(i))).some(Boolean);
            if (anyNew) return;
            const raw = localStorage.getItem(LS_OLD_KEY);
            if (!raw) return;
            const arr = JSON.parse(raw);
            arr.forEach((dataUrl, i) => {
                if (i < count && dataUrl) {
                    try { localStorage.setItem(LS_SLOT(i), dataUrl); } catch (_) {}
                }
            });
            localStorage.removeItem(LS_OLD_KEY);
            LOG('мигрировали слоты из cpv_slots');
        } catch (_) {}
    }

    function loadSlots(count) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            try { arr.push(localStorage.getItem(LS_SLOT(i)) || null); }
            catch (_) { arr.push(null); }
        }
        return arr;
    }
    function loadPauseSlots(count) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            try { arr.push(localStorage.getItem(LS_SLOT_PAUSE(i)) || null); }
            catch (_) { arr.push(null); }
        }
        return arr;
    }

    function saveSlot(i, dataUrl) {
        try {
            if (dataUrl) localStorage.setItem(LS_SLOT(i), dataUrl);
            else         localStorage.removeItem(LS_SLOT(i));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                LOG(`слот ${i}: localStorage переполнен, файл не сохранён`);
                alert(`[TrackFollow] Нет места для слота ${i + 1}.\nУдалите другие слоты или используйте более лёгкие GIF.`);
            } else {
                LOG(`ошибка сохранения слота ${i}:`, e.name);
            }
            return false;
        }
    }
    function savePauseSlot(i, dataUrl) {
        try {
            if (dataUrl) localStorage.setItem(LS_SLOT_PAUSE(i), dataUrl);
            else         localStorage.removeItem(LS_SLOT_PAUSE(i));
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                LOG(`пауза слот ${i}: localStorage переполнен`);
                alert(`[TrackFollow] Нет места для паузного спрайта слота ${i + 1}.\nИспользуйте более лёгкое изображение.`);
            } else {
                LOG(`ошибка сохранения паузного слота ${i}:`, e.name);
            }
            return false;
        }
    }

    function shiftSlotsStorage(fromIdx, newCount) {
        for (let i = fromIdx; i < slotsCount; i++) {
            try { localStorage.removeItem(LS_SLOT(i)); }       catch (_) {}
            try { localStorage.removeItem(LS_SLOT_PAUSE(i)); } catch (_) {}
        }
        for (let i = fromIdx; i < newCount; i++) {
            if (slots[i])      saveSlot(i, slots[i]);
            if (pauseSlots[i]) savePauseSlot(i, pauseSlots[i]);
        }
    }

    function loadActive(count) {
        try {
            const v = parseInt(localStorage.getItem(LS_ACTIVE) ?? '-1', 10);
            return (v >= 0 && v < count) ? v : -1;
        } catch (_) { return -1; }
    }
    function saveActive(i) { try { localStorage.setItem(LS_ACTIVE, String(i)); } catch (_) {} }

    let slotsCount = loadSlotsCount();
    migrateIfNeeded(slotsCount);
    let slots      = loadSlots(slotsCount);
    let pauseSlots = loadPauseSlots(slotsCount);
    let active     = loadActive(slotsCount);

    for (let i = 0; i < slotsCount; i++) {
        setBlobCache(i, slots[i]);
        setBlobCachePause(i, pauseSlots[i]);
    }

    let spriteSize             = 48;
    let offsetX                = 0;
    let offsetY                = 0;
    let lerpSpeed              = 0.18;
    let hideInFullscreen       = true;
    let pauseGif               = false;
    let mirrorStatic           = false;
    let mirrorByDirection      = false;
    let randomizeOnTrackChange = false;

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
    let lastTrackId     = null;

    const SLIDE_DURATION = 180;
    let slideOutEl      = null;
    let slideTimerId    = null;
    let switchInProgress = false;

    // Флаг: пользователь начал закрывать Яндекс-фуллскрин (кнопка или Escape)
    let fsClosing = false;
    let fsClosingTimerId = null;
    function markFsClosing() {
        fsClosing = true;
        syncVisibility();
        if (fsClosingTimerId) clearTimeout(fsClosingTimerId);
        fsClosingTimerId = setTimeout(() => { fsClosing = false; }, 200);
    }

    // Подписка на кнопку закрытия фуллскрина Яндекса
    let fsCloseBtnBound = null;
    function bindFsCloseButton() {
        const btn = document.querySelector(FS_CLOSE_BTN_SEL);
        if (!btn || btn === fsCloseBtnBound) return;
        fsCloseBtnBound = btn;
        btn.addEventListener('click', markFsClosing, { once: true });
    }

    // Escape — capture:true чтобы сработать раньше Яндекса
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && hideInFullscreen && document.querySelector(FS_ROOT_SEL)) {
            markFsClosing();
        }
    }, { capture: true });

    function clearSlideOut() {
        if (slideOutEl) { slideOutEl.remove(); slideOutEl = null; }
        if (slideTimerId) { clearTimeout(slideTimerId); slideTimerId = null; }
        switchInProgress = false;
    }

    function getVisibleSpriteEl() {
        if (canvasEl && canvasEl.style.display !== 'none') return canvasEl;
        return spriteEl;
    }

    function getSrcForSlot(idx, forceMain = false) {
        if (idx < 0) return null;
        const usePause = !forceMain && pauseGif && !wasPlaying && !!pauseSlots[idx];
        return usePause
            ? (getBlobUrlPause(idx) || pauseSlots[idx])
            : (getBlobUrl(idx) || slots[idx]);
    }

    function getScaleX(dir) {
        const flip = mirrorStatic ? -1 : 1;
        const d    = mirrorByDirection ? dir : 1;
        return flip * d;
    }

    const BASE_TRANSFORM = 'translateX(-50%) scaleX(var(--sx))';

    function setSx(el, dir) {
        if (!el) return;
        el.style.setProperty('--sx', String(getScaleX(dir)));
    }

    function initSpriteEl(el, dir) {
        el.style.setProperty('--sx', String(getScaleX(dir)));
        el.style.transform = BASE_TRANSFORM;
    }

    function runSlideIn() {
        if (!spriteEl) return;
        setSx(spriteEl, lastDirection);
        spriteEl.style.transition = 'none';
        spriteEl.style.opacity    = '0';
        spriteEl.style.transform  = `translateX(-50%) translateX(-${spriteSize}px) scaleX(var(--sx))`;
        spriteEl.style.display    = '';

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!spriteEl) return;
                spriteEl.style.transition = `opacity ${SLIDE_DURATION}ms ease`;
                spriteEl.style.transform  = BASE_TRANSFORM;
                spriteEl.style.opacity    = '1';

                slideTimerId = setTimeout(() => {
                    if (spriteEl) {
                        spriteEl.style.transition = '';
                        spriteEl.style.opacity    = '';
                    }
                    clearSlideOut();
                }, SLIDE_DURATION + 50);
            });
        });
    }

    function animateSpriteSwitch(newSrc, needFreeze) {
        clearSlideOut();
        switchInProgress = true;

        const visibleEl = getVisibleSpriteEl();

        if (visibleEl && document.contains(visibleEl)) {
            const clone = visibleEl.cloneNode(true);
            clone.id = 'cpv-sprite-slideout';
            clone.style.transition = `opacity ${SLIDE_DURATION}ms ease`;
            clone.style.willChange = 'opacity';
            visibleEl.parentElement?.appendChild(clone);
            slideOutEl = clone;

            requestAnimationFrame(() => {
                if (!slideOutEl) return;
                slideOutEl.style.opacity = '0';
            });

            slideTimerId = setTimeout(clearSlideOut, SLIDE_DURATION + 50);
        }

        if (canvasEl && canvasEl.style.display !== 'none') {
            canvasEl.style.display = 'none';
        }

        if (!spriteEl) return;

        spriteEl.style.display = 'none';
        spriteEl.style.opacity = '0';

        const onLoaded = () => {
            spriteEl.onload = null;
            if (needFreeze) {
                spriteEl.style.display = '';
                requestAnimationFrame(() => {
                    freezeFrame();
                    runSlideInCanvas();
                });
            } else {
                runSlideIn();
            }
        };

        spriteEl.onload = onLoaded;
        spriteEl.src    = newSrc;

        if (spriteEl.complete) {
            spriteEl.onload = null;
            if (needFreeze) {
                spriteEl.style.display = '';
                requestAnimationFrame(() => {
                    freezeFrame();
                    runSlideInCanvas();
                });
            } else {
                runSlideIn();
            }
        }
    }

    function runSlideInCanvas() {
        if (!canvasEl) return;
        setSx(canvasEl, lastDirection);
        canvasEl.style.transition = 'none';
        canvasEl.style.opacity    = '0';
        canvasEl.style.transform  = `translateX(-50%) translateX(-${spriteSize}px) scaleX(var(--sx))`;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (!canvasEl) return;
                canvasEl.style.transition = `opacity ${SLIDE_DURATION}ms ease`;
                canvasEl.style.transform  = BASE_TRANSFORM;
                canvasEl.style.opacity    = '1';

                slideTimerId = setTimeout(() => {
                    if (canvasEl) {
                        canvasEl.style.transition = '';
                        canvasEl.style.opacity    = '';
                    }
                    clearSlideOut();
                }, SLIDE_DURATION + 50);
            });
        });
    }

    function syncPauseGifAttr() {
        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) return;
        if (pauseGif) wrap.setAttribute('data-pause-gif', '');
        else          wrap.removeAttribute('data-pause-gif');
    }

    function pickRandomSlot() {
        const candidates = [];
        for (let i = 0; i < slotsCount; i++) {
            if (slots[i] && i !== active) candidates.push(i);
        }
        if (candidates.length === 0) return -1;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function isFullscreen() {
        if (document.fullscreenElement) return true;
        if (fsClosing) return false;
        if (document.querySelector(FS_ROOT_SEL)) return true;
        return false;
    }

    function isSplashVisible() {
        const splash = document.querySelector('[class*="SplashScreen_root"]');
        if (!splash) return false;
        return !splash.className.includes('hidden');
    }

    function syncVisibility() {
        const shouldHide = (hideInFullscreen && isFullscreen()) || isSplashVisible();
        [spriteEl, canvasEl].forEach(el => {
            if (!el) return;
            if (shouldHide) {
                el.style.visibility = 'hidden';
                el.setAttribute('aria-hidden', 'true');
            } else {
                el.style.visibility = '';
                el.removeAttribute('aria-hidden');
            }
        });
    }

    // a: нативный fullscreenchange
    document.addEventListener('fullscreenchange', syncVisibility);

    // b: FS_ROOT_SEL пропал из DOM (MutationObserver — debounce через rAF)
    let visDebounceId = null;
    function schedSyncVisibility() {
        if (visDebounceId) return;
        visDebounceId = requestAnimationFrame(() => {
            visDebounceId = null;
            syncVisibility();
        });
    }
    new MutationObserver(schedSyncVisibility)
        .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-scroll-locked'] });

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

    function applyPos(el, left, top) {
        el.style.left = left + 'px';
        if (top !== null) el.style.top = top + 'px';
        setSx(el, lastDirection);
        if (!el.style.transition) {
            el.style.transform = BASE_TRANSFORM;
        }
    }

    function freezeFrame() {
        if (!spriteEl || !canvasEl) return;
        spriteEl.style.display = '';
        const ctx = canvasEl.getContext('2d');
        canvasEl.width  = spriteSize;
        canvasEl.height = spriteSize;
        ctx.drawImage(spriteEl, 0, 0, spriteSize, spriteSize);
        spriteEl.style.display = 'none';
        canvasEl.style.position   = spriteEl.style.position;
        canvasEl.style.zIndex     = spriteEl.style.zIndex;
        canvasEl.style.transform  = spriteEl.style.transform;
        canvasEl.style.left       = spriteEl.style.left;
        canvasEl.style.top        = spriteEl.style.top;
        canvasEl.style.setProperty('--sx', spriteEl.style.getPropertyValue('--sx') || '1');
        canvasEl.style.display    = '';
    }

    function unfreezeFrame() {
        if (!spriteEl || !canvasEl) return;
        spriteEl.style.display    = '';
        spriteEl.style.opacity    = '';
        spriteEl.style.transition = '';
        canvasEl.style.display    = 'none';
    }

    function switchSpriteSrc() {
        if (!spriteEl) return;
        const src = getSrcForSlot(active);
        if (!src) return;
        if (spriteEl.src === src) return;
        spriteEl.src = src;
        if (!wasPlaying && !pauseSlots[active]) {
            spriteEl.onload = () => { freezeFrame(); spriteEl.onload = null; };
        } else {
            unfreezeFrame();
        }
    }

    function startPlayPoll() {
        if (playPollId) return;
        playPollId = setInterval(() => {
            if (!window.pulsesyncApi) return;

            const track = window.pulsesyncApi.getCurrentTrack?.();
            const trackId = track?.id ?? track?.title ?? null;
            if (trackId !== null && trackId !== lastTrackId) {
                const prevTrackId = lastTrackId;
                lastTrackId = trackId;
                if (prevTrackId !== null && active >= 0 && randomizeOnTrackChange) {
                    const next = pickRandomSlot();
                    if (next >= 0) {
                        active = next;
                        saveActive(active);
                        lastDirection = 1;
                        const hadSprite = spriteEl && document.contains(spriteEl);
                        if (hadSprite) {
                            switchSpriteAnimated(next, true);
                        } else {
                            startSprite();
                        }
                        renderAllCards();
                    }
                }
            }

            const playing = window.pulsesyncApi.isPlaying();
            if (playing === wasPlaying) return;
            wasPlaying = playing;
            if (!pauseGif) return;

            if (switchInProgress) return;

            if (pauseSlots[active]) {
                switchSpriteSrc();
            } else {
                if (playing) unfreezeFrame();
                else         freezeFrame();
            }
        }, 100);
    }
    function stopPlayPoll() {
        if (playPollId) { clearInterval(playPollId); playPollId = null; }
    }

    function mountSprite() {
        if (spriteEl && document.contains(spriteEl)) return;
        const src = getSrcForSlot(active);
        if (!src || !getTimecodeWrap()) { unmountSprite(); return; }
        const bar = getPlayerBar();
        if (!bar) return;
        if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';

        spriteEl = document.createElement('img');
        spriteEl.id  = 'cpv-sprite';
        spriteEl.src = src;
        Object.assign(spriteEl.style, {
            width: spriteSize + 'px', height: spriteSize + 'px',
            position: 'absolute',
            transform: BASE_TRANSFORM,
            pointerEvents: 'none', zIndex: '9999',
        });
        spriteEl.style.setProperty('--sx', String(getScaleX(lastDirection)));

        canvasEl = document.createElement('canvas');
        canvasEl.id = 'cpv-sprite-canvas';
        Object.assign(canvasEl.style, {
            width: spriteSize + 'px', height: spriteSize + 'px',
            position: 'absolute',
            transform: BASE_TRANSFORM,
            pointerEvents: 'none', zIndex: '9999',
            display: 'none',
        });
        canvasEl.style.setProperty('--sx', String(getScaleX(lastDirection)));

        bar.appendChild(spriteEl);
        bar.appendChild(canvasEl);
        LOG('спрайт вставлен');

        if (pauseGif && !wasPlaying) {
            if (!pauseSlots[active]) {
                spriteEl.onload = () => { freezeFrame(); spriteEl.onload = null; };
            }
        }
    }

    function unmountSprite() {
        clearSlideOut();
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
        const top = calcTop();

        applyPos(spriteEl, currentLeft, top);
        if (canvasEl && canvasEl.style.display !== 'none')
            applyPos(canvasEl, currentLeft, top);

        if (slideOutEl) {
            slideOutEl.style.left = currentLeft + 'px';
            if (top !== null) slideOutEl.style.top = top + 'px';
        }

        schedTick();
    }
    function schedTick() { rafId = requestAnimationFrame(tickSprite); }

    function switchSpriteAnimated(idx, forceMain = false) {
        if (!spriteEl || !document.contains(spriteEl)) {
            startSprite();
            return;
        }
        const newSrc = getSrcForSlot(idx, forceMain);
        if (!newSrc) return;
        const needFreeze = !forceMain && pauseGif && !wasPlaying && !pauseSlots[idx];
        animateSpriteSwitch(newSrc, needFreeze);
    }

    function startSprite() {
        unmountSprite();
        if (active < 0 || !slots[active]) return;
        if (window.pulsesyncApi) {
            wasPlaying = window.pulsesyncApi.isPlaying() ?? true;
        }
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

    function getNativeContainer() {
        const btn = document.querySelector(NATIVE_BTN_SEL);
        return btn ? btn.parentElement : null;
    }

    function syncWrapWidth() {
        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) return;
        const nativeContainer = getNativeContainer();
        if (!nativeContainer) return;
        const w = nativeContainer.getBoundingClientRect().width;
        if (w > 0) wrap.style.maxWidth = w + 'px';
    }

    window.addEventListener('resize', syncWrapWidth);

    function renderCard(idx) {
        const card = document.querySelector(`[data-cpv-slot="${idx}"]`);
        if (!card) return;
        const hasImage = !!slots[idx];
        const hasPause = !!pauseSlots[idx];
        const isActive = idx === active;
        card.classList.toggle('cpv-has-image', hasImage);
        card.classList.toggle('cpv-has-pause', hasPause);
        card.classList.toggle('cpv-active', isActive);

        const thumb = card.querySelector('.cpv-thumb');
        if (thumb) {
            const url = getBlobUrl(idx);
            thumb.style.backgroundImage = url ? `url("${url}")` : '';
        }
        const icon  = card.querySelector('.cpv-upload-icon');
        const label = card.querySelector('.cpv-upload-label');
        if (icon)  icon.style.display = hasImage ? 'none' : '';
        if (label) label.textContent  = hasImage
            ? (isActive ? '✅ Активный' : 'Активировать')
            : 'Добавить';

        const pauseThumb = card.querySelector('.cpv-pause-thumb');
        if (pauseThumb) {
            const url = getBlobUrlPause(idx);
            pauseThumb.style.backgroundImage = url ? `url("${url}")` : '';
        }
        const pauseLabel = card.querySelector('.cpv-pause-label');
        if (pauseLabel) pauseLabel.textContent = hasPause ? '⏸ пауза' : '⏸ пауза?';
    }

    function renderAllCards() {
        for (let i = 0; i < slotsCount; i++) renderCard(i);
        const addCard = document.querySelector(`#${WRAP_ID} .cpv-add-card`);
        if (addCard) addCard.style.display = slotsCount >= MAX_SLOTS ? 'none' : '';
    }

    function rebuildWrap() {
        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) return;
        wrap.innerHTML = '';
        for (let i = 0; i < slotsCount; i++) wrap.appendChild(createCard(i));
        wrap.appendChild(createAddCard());
        syncWrapWidth();
        syncPauseGifAttr();
        renderAllCards();
    }

    function patchRemoveCard(idx) {
        const wrap = document.getElementById(WRAP_ID);
        if (!wrap) { rebuildWrap(); return; }
        const card = wrap.querySelector(`[data-cpv-slot="${idx}"]`);
        if (card) card.remove();
        wrap.querySelectorAll('[data-cpv-slot]').forEach(c => {
            const oldIdx = parseInt(c.dataset.cpvSlot, 10);
            if (oldIdx > idx) c.dataset.cpvSlot = String(oldIdx - 1);
        });
        renderAllCards();
    }

    function createAddCard() {
        const card = document.createElement('div');
        card.className = 'cpv-upload-card cpv-add-card';
        card.title = 'Добавить слот';
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'cpv-thumb-wrap';
        const icon = document.createElement('span');
        icon.className = 'cpv-upload-icon';
        icon.textContent = '＋';
        thumbWrap.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'cpv-upload-label';
        label.textContent = 'Новый слот';
        card.append(thumbWrap, label);
        card.addEventListener('click', () => {
            if (slotsCount >= MAX_SLOTS) return;
            slots.push(null);
            pauseSlots.push(null);
            slotsCount++;
            saveSlotsCount(slotsCount);
            rebuildWrap();
            LOG(`добавлен слот ${slotsCount - 1}`);
        });
        return card;
    }

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

        const clearBtn = document.createElement('button');
        clearBtn.className = 'cpv-remove-btn cpv-clear-btn';
        clearBtn.textContent = '✕';
        clearBtn.title = 'Очистить';
        clearBtn.addEventListener('click', e => {
            e.stopPropagation();
            const i = parseInt(card.dataset.cpvSlot, 10);
            slots[i] = null;
            saveSlot(i, null);
            setBlobCache(i, null);
            pauseSlots[i] = null;
            savePauseSlot(i, null);
            setBlobCachePause(i, null);
            if (active === i) { active = -1; saveActive(-1); unmountSprite(); }
            renderCard(i);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'cpv-remove-btn cpv-delete-btn';
        deleteBtn.textContent = '🗑';
        deleteBtn.title = 'Удалить слот';
        deleteBtn.addEventListener('click', e => {
            e.stopPropagation();
            const removingIdx = parseInt(card.dataset.cpvSlot, 10);

            const wasActive     = active === removingIdx;
            const activeShifted = active > removingIdx;

            if (wasActive)          { active = -1; saveActive(-1); unmountSprite(); }
            else if (activeShifted) { active--; saveActive(active); }

            shiftBlobCache(removingIdx);

            for (let i = removingIdx; i < slotsCount - 1; i++) {
                slots[i]      = slots[i + 1];
                pauseSlots[i] = pauseSlots[i + 1];
            }
            slots.pop();
            pauseSlots.pop();
            slotsCount--;

            shiftSlotsStorage(removingIdx, slotsCount);
            saveSlotsCount(slotsCount);

            if (slotsCount < 1) {
                slotsCount = 1;
                slots      = [null];
                pauseSlots = [null];
                saveSlotsCount(1);
                rebuildWrap();
                return;
            }

            patchRemoveCard(removingIdx);
            if (activeShifted && active >= 0 && slots[active]) startSprite();
            LOG(`удалён слот ${removingIdx}, осталось ${slotsCount}`);
        });

        const divider = document.createElement('div');
        divider.className = 'cpv-pause-divider';

        const pauseSection = document.createElement('div');
        pauseSection.className = 'cpv-pause-section';

        const pauseThumbWrap = document.createElement('div');
        pauseThumbWrap.className = 'cpv-pause-thumb-wrap';

        const pauseThumb = document.createElement('div');
        pauseThumb.className = 'cpv-pause-thumb';

        const pauseIcon = document.createElement('span');
        pauseIcon.className = 'cpv-pause-icon';
        pauseIcon.textContent = '⏸';

        const pauseClearBtn = document.createElement('button');
        pauseClearBtn.className = 'cpv-pause-clear-btn';
        pauseClearBtn.textContent = '✕';
        pauseClearBtn.title = 'Убрать паузный спрайт';
        pauseClearBtn.addEventListener('click', e => {
            e.stopPropagation();
            const i = parseInt(card.dataset.cpvSlot, 10);
            pauseSlots[i] = null;
            savePauseSlot(i, null);
            setBlobCachePause(i, null);
            renderCard(i);
            if (active === i && pauseGif) {
                if (!wasPlaying) {
                    unfreezeFrame();
                    spriteEl.onload = () => { freezeFrame(); spriteEl.onload = null; };
                    spriteEl.src = getBlobUrl(i) || slots[i];
                } else {
                    switchSpriteSrc();
                }
            }
        });

        pauseThumbWrap.append(pauseThumb, pauseIcon, pauseClearBtn);

        const pauseLabel = document.createElement('span');
        pauseLabel.className = 'cpv-pause-label';
        pauseLabel.textContent = '⏸ пауза?';

        pauseSection.append(pauseThumbWrap, pauseLabel);

        pauseThumbWrap.addEventListener('click', e => {
            e.stopPropagation();
            openPauseFilePicker(card);
        });

        card.append(thumbWrap, label, clearBtn, deleteBtn, divider, pauseSection);

        card.addEventListener('click', e => {
            if (e.target === clearBtn || e.target === deleteBtn) return;
            const i = parseInt(card.dataset.cpvSlot, 10);
            if (slots[i]) {
                if (active === i) {
                    active = -1; saveActive(-1); unmountSprite();
                } else {
                    const hadSprite = spriteEl && document.contains(spriteEl);
                    active = i; saveActive(i);
                    if (hadSprite) {
                        switchSpriteAnimated(i);
                        startPlayPoll();
                    } else {
                        startSprite();
                    }
                }
                renderAllCards();
            } else {
                openFilePicker(card);
            }
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
            const nativeWidth = nativeContainer.getBoundingClientRect().width;
            wrap.style.cssText = [
                `display:${cs.display || 'flex'}`,
                'flex-wrap:wrap',
                `gap:${cs.gap || '8px'}`,
                'margin-bottom:8px',
                nativeWidth > 0 ? `max-width:${nativeWidth}px` : '',
            ].filter(Boolean).join(';');
            for (let i = 0; i < slotsCount; i++) wrap.appendChild(createCard(i));
            wrap.appendChild(createAddCard());
            nativeContainer.parentElement.insertBefore(wrap, nativeContainer);
            syncPauseGifAttr();
            setTimeout(renderAllCards, 0);
            LOG('слоты вставлены');
        }, 0);
    }

    function openFilePicker(cardEl) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
            const file = input.files?.[0]; input.remove();
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { alert('[TrackFollow] Файл слишком большой (макс. 5 МБ).'); return; }
            const currentIdx = parseInt(cardEl.dataset.cpvSlot, 10);
            if (isNaN(currentIdx) || currentIdx < 0 || currentIdx >= slotsCount) {
                LOG('открыт файл-пикер: слот уже не существует, запись отменена');
                return;
            }
            const reader = new FileReader();
            reader.onload = ev => {
                const dataUrl = ev.target.result;
                const finalIdx = parseInt(cardEl.dataset.cpvSlot, 10);
                if (isNaN(finalIdx) || finalIdx < 0 || finalIdx >= slotsCount) {
                    LOG('слот был сдвинут/удалён пока читался файл, запись отменена');
                    return;
                }
                slots[finalIdx] = dataUrl;
                const saved = saveSlot(finalIdx, dataUrl);
                if (!saved) { slots[finalIdx] = null; return; }
                setBlobCache(finalIdx, dataUrl);
                active = finalIdx; saveActive(finalIdx);
                startSprite(); renderAllCards();
            };
            reader.onerror = () => LOG('ошибка чтения');
            reader.readAsDataURL(file);
        });
        input.click();
    }

    function openPauseFilePicker(cardEl) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
            const file = input.files?.[0]; input.remove();
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { alert('[TrackFollow] Файл слишком большой (макс. 5 МБ).'); return; }
            const currentIdx = parseInt(cardEl.dataset.cpvSlot, 10);
            if (isNaN(currentIdx) || currentIdx < 0 || currentIdx >= slotsCount) {
                LOG('паузный файл-пикер: слот не существует, запись отменена');
                return;
            }
            const reader = new FileReader();
            reader.onload = ev => {
                const dataUrl = ev.target.result;
                const finalIdx = parseInt(cardEl.dataset.cpvSlot, 10);
                if (isNaN(finalIdx) || finalIdx < 0 || finalIdx >= slotsCount) {
                    LOG('слот сдвинут/удалён пока читался паузный файл, запись отменена');
                    return;
                }
                pauseSlots[finalIdx] = dataUrl;
                const saved = savePauseSlot(finalIdx, dataUrl);
                if (!saved) { pauseSlots[finalIdx] = null; return; }
                setBlobCachePause(finalIdx, dataUrl);
                renderCard(finalIdx);
                if (active === finalIdx && !wasPlaying && pauseGif) switchSpriteSrc();
            };
            reader.onerror = () => LOG('ошибка чтения паузного файла');
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

        hideInFullscreen       = asBool(s?.hideInFullscreen,       true);
        pauseGif               = asBool(s?.pauseGif,               false);
        mirrorStatic           = asBool(s?.mirrorStatic,           false);
        mirrorByDirection      = asBool(s?.mirrorByDirection,      false);
        randomizeOnTrackChange = asBool(s?.randomizeOnTrackChange, false);

        syncPauseGifAttr();

        if (!pauseGif) {
            if (canvasEl && canvasEl.style.display !== 'none') unfreezeFrame();
            if (active >= 0 && spriteEl) switchSpriteSrc();
        } else if (!wasPlaying) {
            if (active >= 0 && pauseSlots[active]) switchSpriteSrc();
            else freezeFrame();
        }

        updateSpriteStyle();
        syncVisibility();
        if (spriteEl) {
            if (!spriteEl.style.transition) spriteEl.style.transform = BASE_TRANSFORM;
            setSx(spriteEl, lastDirection);
        }
        if (canvasEl && canvasEl.style.display !== 'none') {
            canvasEl.style.transform = BASE_TRANSFORM;
            setSx(canvasEl, lastDirection);
        }
    }
    function initSettings() {
        if (!window.pulsesyncApi) { setTimeout(initSettings, 300); return; }
        const mgr = window.pulsesyncApi.getSettings(ADDON);
        function tryHydrate() {
            const s = mgr.getCurrent();
            if (!s || Object.keys(s).length === 0) { setTimeout(tryHydrate, 200); return; }
            applySettings(s); startSprite();
            const track = window.pulsesyncApi.getCurrentTrack?.();
            lastTrackId = track?.id ?? track?.title ?? null;
        }
        tryHydrate();
        mgr.onChange(s => applySettings(s));
    }

    // c+d: кнопка закрытия и Escape — подписываемся при появлении кнопки в DOM
    new MutationObserver(() => {
        tryInjectCards();
        bindFsCloseButton();
    }).observe(document.body, { childList: true, subtree: true });

    initSettings();
})();
