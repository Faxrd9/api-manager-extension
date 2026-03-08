const LOG_PREFIX = '[API Search]';
const globalAny = /** @type {any} */ (globalThis);

const state = {
    initialized: false,
    keyword: '',
    reinjectTimer: null,
    globalEventsBound: false,
};

const PRESET_DOM = {
    toolbarId: 'api-search-toolbar',
    searchId: 'api-search-input',
    clearId: 'api-search-clear-btn',
    resultId: 'api-search-results',
    statusId: 'api-search-status',
};

const PRESET_PANEL_SELECTORS = [
    '#api_setup_main',
    '#rm_api_block',
    '#api_connection_panel',
    '#main-API-selector-block',
];

const PRESET_SELECT_SELECTORS = [
    '#api_setup_list',
    '#connection_profiles',
];

function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

function getContextSafe() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function resolvePanelHost() {
    for (const selector of PRESET_PANEL_SELECTORS) {
        const node = document.querySelector(selector);
        if (node instanceof HTMLElement) {
            return node;
        }
    }

    return null;
}

function resolvePresetSelect(root) {
    const searchRoot = root instanceof Element || root instanceof Document ? root : document;

    for (const selector of PRESET_SELECT_SELECTORS) {
        const element = searchRoot.querySelector(selector) || document.querySelector(selector);
        if (element instanceof HTMLSelectElement) {
            return element;
        }
    }

    const candidates = Array.from(searchRoot.querySelectorAll('select'));
    return candidates.find((select) => {
        const fingerprint = `${select.id} ${select.name} ${select.className}`.toLowerCase();
        return /preset|profile|setup/.test(fingerprint)
            && !/main_api|chat_completion_source|textgen_type/.test(fingerprint);
    }) || null;
}

function getResultBox(toolbar) {
    if (!(toolbar instanceof HTMLElement)) {
        return null;
    }

    const node = toolbar.querySelector(`#${PRESET_DOM.resultId}`);
    return node instanceof HTMLElement ? node : null;
}

function setStatus(toolbar, message) {
    const status = toolbar?.querySelector?.(`#${PRESET_DOM.statusId}`);
    if (status instanceof HTMLElement) {
        status.textContent = String(message || '');
    }
}

function hideResults(toolbar) {
    const resultBox = getResultBox(toolbar);
    if (!resultBox) {
        return;
    }

    resultBox.hidden = true;
    resultBox.innerHTML = '';
}

function updateClearButton(toolbar) {
    const clear = toolbar?.querySelector?.(`#${PRESET_DOM.clearId}`);
    if (!(clear instanceof HTMLButtonElement)) {
        return;
    }

    const hasKeyword = Boolean(String(state.keyword || '').trim());
    clear.classList.toggle('is-visible', hasKeyword);
    clear.disabled = !hasKeyword;
}

function applySearch(select, toolbar, keyword = state.keyword) {
    if (!(select instanceof HTMLSelectElement)) {
        hideResults(toolbar);
        return;
    }

    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    const entries = Array.from(select.options)
        .map((option, index) => ({
            option,
            index,
            label: String(option.textContent || option.value || '').trim() || `Preset ${index + 1}`,
            value: String(option.value || '').trim(),
        }))
        .filter((entry) => !entry.option.disabled && entry.value);

    const matched = normalizedKeyword
        ? entries.filter((entry) => `${entry.label.toLowerCase()} ${entry.value.toLowerCase()}`.includes(normalizedKeyword))
        : entries;

    setStatus(toolbar, `显示 ${matched.length} / ${entries.length} 条配置`);

    const resultBox = getResultBox(toolbar);
    if (!resultBox) {
        return;
    }

    if (!normalizedKeyword) {
        hideResults(toolbar);
        return;
    }

    if (!matched.length) {
        resultBox.hidden = false;
        resultBox.innerHTML = '<div class="api-manager-search-result-empty">无匹配配置</div>';
        return;
    }

    resultBox.hidden = false;
    resultBox.innerHTML = matched.slice(0, 10).map((item) => `
        <button
            type="button"
            class="api-manager-search-result-item"
            data-option-index="${item.index}"
            title="${escapeHtml(item.label)}"
        >
            <span class="api-manager-search-result-label">${escapeHtml(item.label)}</span>
        </button>
    `).join('');
}

function clearSearch(select, toolbar) {
    state.keyword = '';

    const searchInput = toolbar?.querySelector?.(`#${PRESET_DOM.searchId}`);
    if (searchInput instanceof HTMLInputElement) {
        searchInput.value = '';
    }

    updateClearButton(toolbar);
    applySearch(select, toolbar, '');
}

function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = PRESET_DOM.toolbarId;
    toolbar.className = 'api-manager-injected-toolbar';
    toolbar.innerHTML = `
        <div class="api-manager-search-row">
            <input id="${PRESET_DOM.searchId}" type="search" placeholder="Search API presets..." />
            <button type="button" id="${PRESET_DOM.clearId}" class="api-manager-search-clear-btn" aria-label="clear search" title="clear search">×</button>
            <div id="${PRESET_DOM.resultId}" class="api-manager-search-results" hidden></div>
        </div>
        <div id="${PRESET_DOM.statusId}" class="api-manager-status"></div>
    `;
    return toolbar;
}

function bindGlobalDismiss() {
    if (state.globalEventsBound) {
        return;
    }

    state.globalEventsBound = true;

    document.addEventListener('pointerdown', (event) => {
        const toolbar = document.getElementById(PRESET_DOM.toolbarId);
        if (!(toolbar instanceof HTMLElement)) {
            return;
        }

        if (toolbar.contains(event.target)) {
            return;
        }

        hideResults(toolbar);
    });
}

function bindToolbarEvents(toolbar, select) {
    const searchInput = toolbar.querySelector(`#${PRESET_DOM.searchId}`);
    const clearButton = toolbar.querySelector(`#${PRESET_DOM.clearId}`);
    const resultBox = toolbar.querySelector(`#${PRESET_DOM.resultId}`);

    if (searchInput instanceof HTMLInputElement && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        searchInput.value = state.keyword;

        searchInput.addEventListener('focus', () => {
            applySearch(select, toolbar, state.keyword);
        });

        searchInput.addEventListener('input', (event) => {
            const input = /** @type {HTMLInputElement} */ (event.currentTarget);
            state.keyword = String(input.value || '');
            applySearch(select, toolbar, state.keyword);
            updateClearButton(toolbar);
        });
    }

    if (clearButton instanceof HTMLButtonElement && !clearButton.dataset.bound) {
        clearButton.dataset.bound = '1';
        clearButton.addEventListener('click', () => {
            clearSearch(select, toolbar);
            searchInput?.focus();
        });
    }

    if (resultBox instanceof HTMLElement && !resultBox.dataset.bound) {
        resultBox.dataset.bound = '1';
        resultBox.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });

        resultBox.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('.api-manager-search-result-item')
                : null;

            if (!(target instanceof HTMLButtonElement)) {
                return;
            }

            const optionIndex = Number(target.dataset.optionIndex || -1);
            if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= select.options.length) {
                return;
            }

            const option = select.options[optionIndex];
            if (!(option instanceof HTMLOptionElement)) {
                return;
            }

            select.value = String(option.value || '');
            select.dispatchEvent(new Event('change', { bubbles: true }));
            clearSearch(select, toolbar);
            hideResults(toolbar);
        });
    }

    if (!select.dataset.apiSearchBound) {
        select.dataset.apiSearchBound = '1';
        select.addEventListener('change', () => {
            applySearch(select, toolbar, state.keyword);
        });
    }

    updateClearButton(toolbar);
}

function ensureSearchToolbar() {
    const panel = resolvePanelHost();
    const select = resolvePresetSelect(panel || document);

    if (!(panel instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) {
        return false;
    }

    let toolbar = document.getElementById(PRESET_DOM.toolbarId);
    if (toolbar && toolbar.parentElement !== panel) {
        toolbar.remove();
        toolbar = null;
    }

    if (!(toolbar instanceof HTMLElement)) {
        toolbar = createToolbar();
        panel.insertBefore(toolbar, panel.firstChild || null);
    }

    bindGlobalDismiss();
    bindToolbarEvents(toolbar, select);
    applySearch(select, toolbar, state.keyword);
    return true;
}

function scheduleReinject() {
    setTimeout(() => {
        ensureSearchToolbar();
    }, 60);
}

function bindEventSourceHooks() {
    const context = getContextSafe();
    const source = context?.eventSource || globalThis.eventSource;
    const eventTypes = context?.eventTypes || globalThis.event_types;

    if (!source || typeof source.on !== 'function' || !eventTypes) {
        return;
    }

    const events = [
        eventTypes.APP_READY,
        eventTypes.SETTINGS_UPDATED,
        eventTypes.MAIN_API_CHANGED,
        eventTypes.CONNECTION_PROFILE_CREATED,
        eventTypes.CONNECTION_PROFILE_UPDATED,
        eventTypes.CONNECTION_PROFILE_DELETED,
        eventTypes.CONNECTION_PROFILE_LOADED,
    ].filter(Boolean);

    events.forEach((eventName) => {
        source.on(eventName, scheduleReinject);
    });
}

async function waitForReady(timeoutMs = 12000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (document.body && typeof (globalAny.jQuery || globalAny.$) === 'function') {
            return true;
        }
        await sleep(120);
    }

    return false;
}

export async function initApiManagerExtension() {
    if (state.initialized) {
        ensureSearchToolbar();
        return;
    }

    const ready = await waitForReady();
    if (!ready) {
        throw new Error('等待 API Search 初始化超时');
    }

    ensureSearchToolbar();
    bindEventSourceHooks();

    if (!state.reinjectTimer) {
        state.reinjectTimer = setInterval(() => {
            ensureSearchToolbar();
        }, 1200);
    }

    state.initialized = true;
    log('initialized');
}
