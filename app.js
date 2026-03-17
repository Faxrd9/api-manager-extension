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
        <div class="api-manager-actions-row">
            <button type="button" id="api-manager-export-btn" class="api-manager-action-btn" title="导出所有 API 配置（密钥+连接设置）">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>导出配置</span>
            </button>
            <button type="button" id="api-manager-import-btn" class="api-manager-action-btn" title="导入 API 配置（密钥+连接设置）">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span>导入配置</span>
            </button>
            <input type="file" id="api-manager-import-file" accept=".json" style="display: none;" />
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

/**
 * 获取请求头
 * @returns {Object} 请求头对象
 */
function getRequestHeaders() {
    const context = getContextSafe();
    if (context?.getRequestHeaders) {
        return context.getRequestHeaders();
    }
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '',
    };
}

/**
 * 获取 API URL 配置（精简版）
 * @returns {Promise<Object>} API URL 配置对象
 */
async function getApiConnectionSettings() {
    try {
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.settings) {
            return {};
        }

        const settings = JSON.parse(data.settings);

        // 只提取 URL 相关配置
        const apiConfig = {};

        // Kobold URL
        if (settings.kai_settings?.api_server) {
            apiConfig.kai_api_server = settings.kai_settings.api_server;
        }

        // TextGen URL
        if (settings.textgenerationwebui_settings?.api_server) {
            apiConfig.textgen_api_server = settings.textgenerationwebui_settings.api_server;
        }

        // NovelAI 不需要 URL（固定）

        // OpenAI 相关 URL
        if (settings.oai_settings) {
            const oai = settings.oai_settings;
            if (oai.openai_reverse_proxy) {
                apiConfig.openai_reverse_proxy = oai.openai_reverse_proxy;
            }
            if (oai.custom_url) {
                apiConfig.custom_url = oai.custom_url;
            }
            if (oai.custom_oai_url) {
                apiConfig.custom_oai_url = oai.custom_oai_url;
            }
        }

        // Horde 不需要 URL（固定）

        return apiConfig;
    } catch (error) {
        console.error(LOG_PREFIX, '获取 API URL 失败:', error);
        return {};
    }
}

/**
 * 保存 API URL 配置（精简版）
 * @param {Object} apiConfig - API URL 配置对象
 */
async function saveApiConnectionSettings(apiConfig) {
    try {
        // 先获取当前设置
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({}),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const currentSettings = data.settings ? JSON.parse(data.settings) : {};

        // 只更新 URL 相关配置
        if (apiConfig.kai_api_server) {
            currentSettings.kai_settings = currentSettings.kai_settings || {};
            currentSettings.kai_settings.api_server = apiConfig.kai_api_server;
        }

        if (apiConfig.textgen_api_server) {
            currentSettings.textgenerationwebui_settings = currentSettings.textgenerationwebui_settings || {};
            currentSettings.textgenerationwebui_settings.api_server = apiConfig.textgen_api_server;
        }

        if (apiConfig.openai_reverse_proxy) {
            currentSettings.oai_settings = currentSettings.oai_settings || {};
            currentSettings.oai_settings.openai_reverse_proxy = apiConfig.openai_reverse_proxy;
        }

        if (apiConfig.custom_url) {
            currentSettings.oai_settings = currentSettings.oai_settings || {};
            currentSettings.oai_settings.custom_url = apiConfig.custom_url;
        }

        if (apiConfig.custom_oai_url) {
            currentSettings.oai_settings = currentSettings.oai_settings || {};
            currentSettings.oai_settings.custom_oai_url = apiConfig.custom_oai_url;
        }

        // 保存设置
        const saveResponse = await fetch('/api/settings/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(currentSettings),
        });

        if (!saveResponse.ok) {
            throw new Error(`HTTP error! status: ${saveResponse.status}`);
        }

        return true;
    } catch (error) {
        console.error(LOG_PREFIX, '保存 API URL 失败:', error);
        return false;
    }
}

/**
 * 导出所有 API 配置（包括密钥和连接配置）
 */
async function exportApiKeys() {
    try {
        // 1. 获取 API 密钥
        const secretsResponse = await fetch('/api/secrets/view', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        let secrets = {};
        if (secretsResponse.status === 403) {
            setStatus(document.getElementById(PRESET_DOM.toolbarId), '警告: 请在 config.yaml 中设置 allowKeysExposure 为 true 以导出密钥');
        } else if (secretsResponse.ok) {
            secrets = await secretsResponse.json();
        }

        // 2. 获取 API 连接配置
        const apiConfig = await getApiConnectionSettings();

        // 3. 合并数据
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            secrets: secrets,
            apiConfig: apiConfig,
        };

        // 4. 创建下载
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `api-config-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const secretCount = Object.keys(secrets).length;
        setStatus(document.getElementById(PRESET_DOM.toolbarId), `已导出: ${secretCount} 个密钥 + API 连接配置`);
    } catch (error) {
        console.error(LOG_PREFIX, '导出 API 配置失败:', error);
        setStatus(document.getElementById(PRESET_DOM.toolbarId), '导出失败: ' + error.message);
    }
}

/**
 * 导入 API 配置（包括密钥和连接配置）
 * @param {File} file - 要导入的 JSON 文件
 */
async function importApiKeys(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data || typeof data !== 'object') {
            throw new Error('无效的 JSON 格式');
        }

        let importedSecrets = 0;
        let skippedSecrets = 0;
        let importedConfig = false;

        // 1. 导入 API 密钥（如果存在）
        if (data.secrets && typeof data.secrets === 'object') {
            // 获取当前状态以检查现有密钥
            const viewResponse = await fetch('/api/secrets/view', {
                method: 'POST',
                headers: getRequestHeaders(),
            });

            let existingKeys = {};
            if (viewResponse.ok) {
                existingKeys = await viewResponse.json();
            }

            for (const [key, value] of Object.entries(data.secrets)) {
                // 跳过非字符串值
                if (typeof value !== 'string') {
                    skippedSecrets++;
                    continue;
                }

                // 如果密钥已存在且值相同，则跳过
                if (existingKeys[key] === value) {
                    skippedSecrets++;
                    continue;
                }

                // 写入密钥
                const writeResponse = await fetch('/api/secrets/write', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        key,
                        value,
                        label: `导入于 ${new Date().toLocaleString('zh-CN')}`
                    }),
                });

                if (writeResponse.ok) {
                    importedSecrets++;
                } else {
                    skippedSecrets++;
                }
            }

            // 刷新密钥状态
            const context = getContextSafe();
            if (context?.eventSource && context?.eventTypes?.SECRET_WRITTEN) {
                await context.eventSource.emit(context.eventTypes.SECRET_WRITTEN);
            }
        }

        // 2. 导入 API 连接配置（如果存在）
        if (data.apiConfig && typeof data.apiConfig === 'object') {
            const saveResult = await saveApiConnectionSettings(data.apiConfig);
            if (saveResult) {
                importedConfig = true;
            }
        }

        // 3. 刷新页面以应用新配置
        if (importedConfig) {
            setStatus(document.getElementById(PRESET_DOM.toolbarId), `导入完成: ${importedSecrets} 个密钥, 配置已更新，刷新中...`);
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            setStatus(document.getElementById(PRESET_DOM.toolbarId), `导入完成: ${importedSecrets} 个密钥成功, ${skippedSecrets} 个跳过`);

            // 触发 API 重新连接
            const mainApi = document.querySelector('#main_api');
            if (mainApi) {
                mainApi.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    } catch (error) {
        console.error(LOG_PREFIX, '导入 API 配置失败:', error);
        setStatus(document.getElementById(PRESET_DOM.toolbarId), '导入失败: ' + error.message);
    }
}

function bindToolbarEvents(toolbar, select) {
    const searchInput = toolbar.querySelector(`#${PRESET_DOM.searchId}`);
    const clearButton = toolbar.querySelector(`#${PRESET_DOM.clearId}`);
    const resultBox = toolbar.querySelector(`#${PRESET_DOM.resultId}`);
    const exportBtn = toolbar.querySelector('#api-manager-export-btn');
    const importBtn = toolbar.querySelector('#api-manager-import-btn');
    const importFile = toolbar.querySelector('#api-manager-import-file');

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

    // 绑定导出按钮事件
    if (exportBtn instanceof HTMLButtonElement && !exportBtn.dataset.bound) {
        exportBtn.dataset.bound = '1';
        exportBtn.addEventListener('click', () => {
            void exportApiKeys();
        });
    }

    // 绑定导入按钮事件
    if (importBtn instanceof HTMLButtonElement && !importBtn.dataset.bound) {
        importBtn.dataset.bound = '1';
        importBtn.addEventListener('click', () => {
            importFile?.click();
        });
    }

    // 绑定文件选择事件
    if (importFile instanceof HTMLInputElement && !importFile.dataset.bound) {
        importFile.dataset.bound = '1';
        importFile.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (file) {
                void importApiKeys(file);
                // 重置 input 以便可以再次选择同一文件
                event.target.value = '';
            }
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
