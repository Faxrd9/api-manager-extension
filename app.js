const LOG_PREFIX = '[API管理器]';
const EVENT_NS = '.apiManagerExt';
const STORE_KEY = 'api_profiles';
const globalAny = /** @type {any} */ (globalThis);
// 兼容 TS checkJs：显式声明 $，并在运行时动态获取 jQuery，避免初始化时机问题
function $(...args) {
    const jq = globalAny.jQuery || globalAny.$;
    if (typeof jq !== 'function') {
        throw new Error('jQuery 未就绪，无法执行 API 管理器操作');
    }
    return jq(...args);
}

const UI = {
    trigger: '.api-manager-trigger-btn',
    inlineTrigger: '#api-manager-trigger-btn',
    container: '#api-manager-inline-container',
    overlay: '#api-manager-overlay',
    floatingTrigger: '#api-manager-trigger-floating-btn',
    panel: '#api-manager-panel',
    list: '#api-manager-list',
    count: '#api-manager-count',
    search: '#api-manager-search',
    sort: '#api-manager-sort',
    nameInput: '#api-manager-name',
    importInput: '#api-manager-import-input',
};

const API_PANEL_HOST_SELECTORS = [
    '#api_connection_panel', // 旧版本
    '#rm_api_block', // 新版 API 抽屉主容器
    '#main-API-selector-block',
];

const SORT_OPTIONS = ['last_used', 'created_at', 'name'];

const state = {
    initialized: false,
    panelOpen: false,
    searchKeyword: '',
    sortBy: 'last_used',
    searchTimer: null,
    presetInjectTimer: null,
    importMode: 'merge',
    applyLock: false,
    reinjectTimer: null,
    presetGlobalEventsBound: false,
};

const OPENAI_SOURCE_TYPES = new Set([
    'openai',
    'claude',
    'scale',
    'ai21',
    'openrouter',
    'mistralai',
    'groq',
    'perplexity',
    'deepseek',
    'custom',
    'makersuite',
    'vertexai',
    'cohere',
    'xai',
    'aimlapi',
    'moonshot',
    'fireworks',
    'zai',
    'chutes',
    'pollinations',
    'electronhub',
    'nanogpt',
    'siliconflow',
    'cometapi',
]);

const GENERIC_SELECTORS = {
    url: ['#openai_reverse_proxy', '#custom_api_url_text', '#api_url_text', '#generic_api_url_text'],
    key: ['#api_key_openai', '#api_key_claude', '#api_key_openrouter', '#api_key_custom'],
    model: ['#model_openai_select', '#model_claude_select', '#model_openrouter_select', '#model_custom_select', '#custom_model_id'],
    connect: ['#api_button_openai', '#api_button_claude'],
};

const API_META = {
    openai: {
        label: 'OpenAI',
        mainApi: 'openai',
        source: 'openai',
        url: ['#openai_reverse_proxy'],
        key: ['#api_key_openai'],
        model: ['#model_openai_select'],
        connect: ['#api_button_openai'],
    },
    claude: {
        label: 'Claude',
        mainApi: 'openai',
        source: 'claude',
        url: ['#openai_reverse_proxy'],
        key: ['#api_key_claude'],
        model: ['#model_claude_select'],
        connect: ['#api_button_claude', '#api_button_openai'],
    },
    scale: {
        label: 'Scale',
        mainApi: 'openai',
        source: 'scale',
        url: ['#openai_reverse_proxy', '#api_url_scale'],
        key: ['#api_key_scale', '#api_key_openai'],
        model: ['#model_scale_select', '#model_openai_select'],
        connect: ['#api_button_openai'],
    },
    ai21: {
        label: 'AI21',
        mainApi: 'openai',
        source: 'ai21',
        url: ['#openai_reverse_proxy', '#api_url_ai21'],
        key: ['#api_key_ai21'],
        model: ['#model_ai21_select'],
        connect: ['#api_button_openai'],
    },
    openrouter: {
        label: 'OpenRouter',
        mainApi: 'openai',
        source: 'openrouter',
        url: ['#openai_reverse_proxy'],
        key: ['#api_key_openrouter'],
        model: ['#model_openrouter_select'],
        connect: ['#api_button_openai'],
    },
    custom: {
        label: 'Custom',
        mainApi: 'openai',
        source: 'custom',
        url: ['#custom_api_url_text'],
        key: ['#api_key_custom'],
        model: ['#custom_model_id', '#model_custom_select'],
        connect: ['#api_button_openai'],
    },
};

const FAIL_TOKENS = [
    'no connection',
    'not connected',
    'invalid',
    'could not',
    'failed',
    'error',
    '连接失败',
    '未连接',
    '错误',
    '失败',
];

const SUCCESS_TOKENS = [
    'valid',
    'connected',
    'status check bypassed',
    'key saved',
    '连接成功',
    '已连接',
    '成功',
    '已保存',
];

function log(...args) {
    console.log(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

function getContextSafe() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function getExtensionSettingsStore() {
    const contextStore = getContextSafe()?.extensionSettings;
    if (contextStore && typeof contextStore === 'object') {
        return contextStore;
    }

    if (globalThis.extension_settings && typeof globalThis.extension_settings === 'object') {
        return globalThis.extension_settings;
    }

    return null;
}

function requestSaveSettings() {
    const contextSave = getContextSafe()?.saveSettingsDebounced;
    const saveFn = typeof contextSave === 'function'
        ? contextSave
        : globalThis.saveSettingsDebounced;

    if (typeof saveFn === 'function') {
        saveFn();
        return true;
    }

    return false;
}

function toast(type, message) {
    if (globalThis.toastr && typeof globalThis.toastr[type] === 'function') {
        globalThis.toastr[type](message);
        return;
    }
    if (type === 'error') {
        console.error(LOG_PREFIX, message);
    } else {
        console.log(LOG_PREFIX, message);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEnvironmentReady(timeoutMs = 15000) {
    const begin = Date.now();

    while (Date.now() - begin < timeoutMs) {
        const hasJquery = typeof (globalAny.jQuery || globalAny.$) === 'function';
        const hasStore = !!getExtensionSettingsStore();

        if (hasJquery && hasStore) {
            return true;
        }

        await sleep(200);
    }

    return false;
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function generateId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `api_profile_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function maskSecret(secret) {
    const text = String(secret || '');
    if (!text) return '未设置';
    if (text.length <= 6) return '*'.repeat(text.length);
    return `${text.slice(0, 3)}****${text.slice(-3)}`;
}

function toTimestamp(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeApiType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (!normalized) return 'openai';

    const aliasMap = {
        anthropic: 'claude',
        custom_openai: 'custom',
    };
    return aliasMap[normalized] || normalized;
}

function formatApiType(type) {
    const normalized = normalizeApiType(type);
    return API_META[normalized]?.label || normalized.toUpperCase();
}

function getDefaultStore() {
    return {
        version: 1,
        active_profile_id: null,
        profiles: [],
        settings: {
            sort_by: 'last_used',
        },
    };
}

function getXorSeed() {
    return String(navigator.userAgent || 'SillyTavern_API_MANAGER');
}

function stringToBase64(text) {
    try {
        const bytes = new TextEncoder().encode(String(text));
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    } catch (error) {
        return btoa(unescape(encodeURIComponent(String(text))));
    }
}

function base64ToString(base64) {
    try {
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch (error) {
        return decodeURIComponent(escape(atob(base64)));
    }
}

function xorTransform(input, key) {
    const source = String(input || '');
    const xorKey = String(key || '');
    if (!source || !xorKey) return source;

    let output = '';
    for (let index = 0; index < source.length; index += 1) {
        output += String.fromCharCode(source.charCodeAt(index) ^ xorKey.charCodeAt(index % xorKey.length));
    }
    return output;
}

function encryptKey(plainText) {
    const source = String(plainText || '');
    if (!source) return '';
    if (source.startsWith('xor:')) return source;

    const mixed = xorTransform(source, getXorSeed());
    return `xor:${stringToBase64(mixed)}`;
}

function decryptKey(cipherText) {
    const source = String(cipherText || '');
    if (!source) return '';
    if (!source.startsWith('xor:')) return source;

    try {
        const raw = source.slice(4);
        const mixed = base64ToString(raw);
        return xorTransform(mixed, getXorSeed());
    } catch (error) {
        logError('解密密钥失败，返回空值', error);
        return '';
    }
}

function normalizeProfile(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const now = Date.now();
    const profile = {
        id: String(raw.id || generateId()),
        name: String(raw.name || '').trim() || `未命名配置-${new Date(now).toLocaleTimeString('zh-CN', { hour12: false })}`,
        api_type: normalizeApiType(raw.api_type || raw.provider || raw.apiType || 'openai'),
        url: String(raw.url || raw.baseUrl || '').trim(),
        key: String(raw.key || raw.apiKey || '').trim(),
        model: String(raw.model || '').trim(),
        created_at: toTimestamp(raw.created_at || raw.createdAt, now),
        updated_at: toTimestamp(raw.updated_at || raw.updatedAt, now),
        last_used: toTimestamp(raw.last_used || raw.lastUsed, 0),
    };

    profile.key = encryptKey(profile.key);
    return profile;
}

function normalizeStore(rawStore) {
    const defaults = getDefaultStore();
    const source = rawStore && typeof rawStore === 'object' ? rawStore : {};
    const normalizedProfiles = Array.isArray(source.profiles)
        ? source.profiles.map(normalizeProfile).filter(Boolean)
        : [];

    const sortBy = SORT_OPTIONS.includes(source.settings?.sort_by)
        ? source.settings.sort_by
        : defaults.settings.sort_by;

    const activeId = String(source.active_profile_id || '');
    const activeExists = normalizedProfiles.some((profile) => profile.id === activeId);

    return {
        version: 1,
        active_profile_id: activeExists ? activeId : null,
        profiles: normalizedProfiles,
        settings: {
            sort_by: sortBy,
        },
    };
}

function ensureStore() {
    const storeRoot = getExtensionSettingsStore();

    if (!storeRoot || typeof storeRoot !== 'object') {
        throw new Error('extension_settings 不可用，无法初始化 API 管理器');
    }

    const normalized = normalizeStore(storeRoot[STORE_KEY]);
    storeRoot[STORE_KEY] = normalized;
    return normalized;
}

function saveStore() {
    try {
        requestSaveSettings();
    } catch (error) {
        logError('保存扩展设置失败', error);
    }
}

function getApiMeta(apiType) {
    const type = normalizeApiType(apiType);
    if (API_META[type]) return API_META[type];

    const openaiSource = OPENAI_SOURCE_TYPES.has(type);
    const mainApi = openaiSource ? 'openai' : type;

    return {
        label: formatApiType(type),
        mainApi,
        source: openaiSource ? type : '',
        url: [`#api_url_${type}`, ...GENERIC_SELECTORS.url],
        key: [`#api_key_${type}`, ...GENERIC_SELECTORS.key],
        model: [`#model_${type}_select`, `#model_${type}`, ...GENERIC_SELECTORS.model],
        connect: mainApi === 'openai' ? GENERIC_SELECTORS.connect : [`#api_button_${mainApi}`, ...GENERIC_SELECTORS.connect],
    };
}

function getPreferredElement(selector) {
    const $all = $(selector);
    if (!$all.length) return null;
    const $visible = $all.filter(':visible').first();
    return $visible.length ? $visible : $all.first();
}

function readFirstValue(selectors, options = {}) {
    const { nonEmptyOnly = false } = options;
    for (const selector of selectors) {
        const $el = getPreferredElement(selector);
        if (!$el || !$el.length) continue;

        const value = String($el.val() ?? '').trim();
        if (nonEmptyOnly && !value) continue;
        return value;
    }
    return '';
}

function writeValue(selectors, value) {
    const targetValue = String(value ?? '');

    for (const selector of selectors) {
        const $el = getPreferredElement(selector);
        if (!$el || !$el.length) continue;

        if ($el.is('select')) {
            const hasOption = $el.find('option').toArray().some((option) => String(option.value) === targetValue);
            if (!hasOption && targetValue) {
                $el.append($('<option></option>').val(targetValue).text(targetValue));
            }
            $el.val(targetValue);
            $el.trigger('change');
            return true;
        }

        $el.val(targetValue);
        $el.trigger('input');
        $el.trigger('change');
        return true;
    }
    return false;
}

function detectCurrentApiType() {
    const mainApi = normalizeApiType(String($('#main_api').val() || ''));
    if (mainApi === 'openai') {
        const source = normalizeApiType(String($('#chat_completion_source').val() || 'openai'));
        return source || 'openai';
    }
    if (mainApi === 'textgenerationwebui') {
        const source = normalizeApiType(String($('#textgen_type').val() || 'textgenerationwebui'));
        return source || 'textgenerationwebui';
    }
    return mainApi || 'openai';
}

/**
 * 读取当前 UI 上的 API 配置（当前选择类型 + URL/Key/Model）
 */
export function captureCurrentConfig() {
    const apiType = detectCurrentApiType();
    const meta = getApiMeta(apiType);

    const url = readFirstValue([...meta.url, ...GENERIC_SELECTORS.url], { nonEmptyOnly: true });
    const key = readFirstValue([...meta.key, ...GENERIC_SELECTORS.key]);
    const model = readFirstValue([...meta.model, ...GENERIC_SELECTORS.model]);

    return {
        api_type: apiType,
        url,
        key,
        model,
    };
}

async function setApiTypeInUi(apiType) {
    const meta = getApiMeta(apiType);
    writeValue(['#main_api'], meta.mainApi);
    await sleep(120);

    if (meta.mainApi === 'openai' && meta.source) {
        writeValue(['#chat_completion_source'], meta.source);
        await sleep(120);
    } else if (meta.mainApi === 'textgenerationwebui') {
        writeValue(['#textgen_type'], meta.source || apiType);
        await sleep(120);
    }
}

async function fillConfigToUi(config) {
    const meta = getApiMeta(config.api_type);
    await setApiTypeInUi(config.api_type);

    writeValue([...meta.url, ...GENERIC_SELECTORS.url], config.url || '');
    writeValue([...meta.key, ...GENERIC_SELECTORS.key], config.key || '');
    writeValue([...meta.model, ...GENERIC_SELECTORS.model], config.model || '');

    requestSaveSettings();

    await sleep(120);
}

async function disconnectIfBusy() {
    const $cancelBtn = getVisibleLoadingButtons().first();
    if ($cancelBtn.length) {
        $cancelBtn.trigger('click');
        await sleep(300);
    }
}

function getConnectButton(apiType) {
    const meta = getApiMeta(apiType);
    for (const selector of [...meta.connect, ...GENERIC_SELECTORS.connect]) {
        const $btn = getPreferredElement(selector);
        if ($btn && $btn.length) return $btn;
    }
    return null;
}

async function clickConnect(apiType) {
    const $connectButton = getConnectButton(apiType);
    if (!$connectButton || !$connectButton.length) {
        throw new Error('未找到可用的连接按钮');
    }
    $connectButton.trigger('click');
}

function readStatusText() {
    const visibleTexts = getVisibleStatusElements().toArray()
        .map((el) => String($(el).text() || '').trim())
        .filter(Boolean);

    if (visibleTexts.length) return visibleTexts.join(' | ');
    return '';
}

async function verifyConnection(timeoutMs = 12000) {
    const begin = Date.now();

    while (Date.now() - begin < timeoutMs) {
        const statusText = readStatusText().toLowerCase();
        const isLoading = getVisibleLoadingButtons().length > 0;

        if (statusText) {
            const success = SUCCESS_TOKENS.some((token) => statusText.includes(token));
            const failed = FAIL_TOKENS.some((token) => statusText.includes(token));

            if (success) return true;
            if (failed) {
                throw new Error(`连接状态异常：${statusText}`);
            }
        }

        if (!isLoading && Date.now() - begin > 2000) {
            return true;
        }

        await sleep(300);
    }

    throw new Error('连接验证超时，请检查 API 可用性');
}

function upsertProfile(profile) {
    const store = ensureStore();
    const index = store.profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) {
        store.profiles[index] = profile;
    } else {
        store.profiles.unshift(profile);
    }
    saveStore();
}

function markProfileActive(profileId) {
    const store = ensureStore();
    const now = Date.now();
    const index = store.profiles.findIndex((item) => item.id === profileId);

    if (index >= 0) {
        store.profiles[index].last_used = now;
        store.profiles[index].updated_at = now;
        store.active_profile_id = profileId;
        saveStore();
    }
}

/**
 * 应用指定配置：备份 -> 断开 -> 填充 -> 连接 -> 验证
 * 若失败则自动尝试回滚到原配置。
 */
export async function applyProfile(profile) {
    const normalized = normalizeProfile(profile);
    if (!normalized) {
        throw new Error('无效配置，无法应用');
    }

    if (state.applyLock) {
        toast('warning', '正在切换配置，请稍候...');
        return;
    }

    state.applyLock = true;
    const backup = captureCurrentConfig();
    const targetConfig = {
        api_type: normalized.api_type,
        url: normalized.url,
        key: decryptKey(normalized.key),
        model: normalized.model,
    };

    try {
        log('开始应用配置', normalized.name);
        await disconnectIfBusy();
        await fillConfigToUi(targetConfig);
        await clickConnect(targetConfig.api_type);
        await verifyConnection();

        markProfileActive(normalized.id);
        renderProfileList();
        toast('success', `已切换到配置：${normalized.name}`);
    } catch (error) {
        logError('配置切换失败，准备回滚', error);

        try {
            await disconnectIfBusy();
            await fillConfigToUi(backup);
            await clickConnect(backup.api_type);
            await verifyConnection();
            toast('warning', '切换失败，已自动回滚到原配置');
        } catch (rollbackError) {
            logError('回滚失败', rollbackError);
        }

        toast('error', `切换失败：${error.message || error}`);
        throw error;
    } finally {
        state.applyLock = false;
    }
}

function getCurrentSort() {
    const store = ensureStore();
    return SORT_OPTIONS.includes(state.sortBy) ? state.sortBy : store.settings.sort_by;
}

function getFilteredProfiles() {
    const store = ensureStore();
    const keyword = state.searchKeyword.trim().toLowerCase();
    const sortBy = getCurrentSort();

    const filtered = store.profiles.filter((profile) => {
        if (!keyword) return true;
        const haystack = [profile.name, profile.url, profile.api_type, profile.model]
            .join(' ')
            .toLowerCase();
        return haystack.includes(keyword);
    });

    filtered.sort((a, b) => {
        if (sortBy === 'name') {
            return String(a.name).localeCompare(String(b.name), 'zh-CN');
        }
        if (sortBy === 'created_at') {
            return (b.created_at || 0) - (a.created_at || 0);
        }
        return (b.last_used || 0) - (a.last_used || 0) || (b.updated_at || 0) - (a.updated_at || 0);
    });

    return filtered;
}

function formatTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return '—';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function createCardHtml(profile, isActive) {
    const plainKey = decryptKey(profile.key);

    return `
        <div class="api-manager-card ${isActive ? 'is-active' : ''}" data-id="${escapeHtml(profile.id)}">
            <div class="api-manager-card-header">
                <div class="api-manager-card-title-wrap">
                    <div class="api-manager-card-title">${escapeHtml(profile.name)}</div>
                    <div class="api-manager-card-subtitle">${escapeHtml(formatApiType(profile.api_type))}</div>
                </div>
                ${isActive ? '<span class="api-manager-active-tag">激活中</span>' : ''}
            </div>
            <div class="api-manager-card-meta">URL：${escapeHtml(profile.url || '未设置')}</div>
            <div class="api-manager-card-meta">模型：${escapeHtml(profile.model || '未设置')}</div>
            <div class="api-manager-card-meta">密钥：${escapeHtml(maskSecret(plainKey))}</div>
            <div class="api-manager-card-meta">最近使用：${escapeHtml(formatTime(profile.last_used))}</div>
            <div class="api-manager-card-actions">
                <button type="button" class="menu_button api-manager-action-apply" data-id="${escapeHtml(profile.id)}">切换</button>
                <button type="button" class="menu_button api-manager-action-overwrite" data-id="${escapeHtml(profile.id)}">用当前覆盖</button>
                <button type="button" class="menu_button api-manager-action-delete" data-id="${escapeHtml(profile.id)}">删除</button>
            </div>
        </div>
    `;
}

function renderProfileList() {
    const store = ensureStore();
    const profiles = getFilteredProfiles();
    const $list = $(UI.list);

    if (!$list.length) return;

    $(UI.count).text(`共 ${profiles.length} 条`);
    $(UI.sort).val(getCurrentSort());

    if (profiles.length === 0) {
        $list.html('<div class="api-manager-empty">暂无匹配配置</div>');
        return;
    }

    const html = profiles
        .map((profile) => createCardHtml(profile, profile.id === store.active_profile_id))
        .join('');

    $list.html(html);
}

function saveCurrentAsProfile() {
    try {
        const config = captureCurrentConfig();
        if (!config.url && !config.key && !config.model) {
            toast('warning', '当前页面未检测到可保存的 API 配置信息');
            return;
        }

        const customName = String($(UI.nameInput).val() || '').trim();
        const now = Date.now();
        const profile = normalizeProfile({
            id: generateId(),
            name: customName || `${formatApiType(config.api_type)}-${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
            api_type: config.api_type,
            url: config.url,
            key: encryptKey(config.key),
            model: config.model,
            created_at: now,
            updated_at: now,
            last_used: 0,
        });

        upsertProfile(profile);
        $(UI.nameInput).val('');
        renderProfileList();
        toast('success', '当前 API 配置已保存');
    } catch (error) {
        logError('保存当前配置失败', error);
        toast('error', `保存失败：${error.message || error}`);
    }
}

function overwriteProfileByCurrent(profileId) {
    const store = ensureStore();
    const index = store.profiles.findIndex((profile) => profile.id === profileId);
    if (index < 0) {
        toast('error', '目标配置不存在，无法覆盖');
        return;
    }

    const current = captureCurrentConfig();
    const now = Date.now();
    const original = store.profiles[index];

    store.profiles[index] = normalizeProfile({
        ...original,
        api_type: current.api_type,
        url: current.url,
        key: encryptKey(current.key),
        model: current.model,
        updated_at: now,
    });

    saveStore();
    renderProfileList();
    toast('success', `已覆盖配置：${original.name}`);
}

function removeProfile(profileId) {
    const store = ensureStore();
    const profile = store.profiles.find((item) => item.id === profileId);
    if (!profile) {
        toast('warning', '目标配置不存在');
        return;
    }

    if (!window.confirm(`确定删除配置「${profile.name}」吗？`)) {
        return;
    }

    store.profiles = store.profiles.filter((item) => item.id !== profileId);
    if (store.active_profile_id === profileId) {
        store.active_profile_id = null;
    }

    saveStore();
    renderProfileList();
    toast('success', '配置已删除');
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

const PRESET_DOM = {
    toolbarId: 'api-manager-toolbar',
    searchId: 'api-search-bar',
    searchClearId: 'api-search-clear-btn',
    searchResultsId: 'api-manager-search-results',
    importButtonId: 'api-manager-import-btn',
    exportButtonId: 'api-manager-export-btn',
    fileInputId: 'api-manager-import-file',
    statusId: 'api-manager-status',
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

const PRESET_SELECT_EXPAND_MIN_ROWS = 1;
const PRESET_SELECT_EXPAND_MAX_ROWS = 10;
const PRESET_SEARCH_MAX_RESULTS = 8;

const PRESET_HINT_KEYS = [
    'main_api',
    'chat_completion_source',
    'textgen_type',
    'openai_reverse_proxy',
    'custom_api_url_text',
    'api_url_text',
    'generic_api_url_text',
    'api_key_openai',
    'api_key_claude',
    'api_key_openrouter',
    'api_key_custom',
    'api_key_scale',
    'api_key_ai21',
    'api_key_cohere',
    'api_key_mistralai',
    'api_key_groq',
    'model_openai_select',
    'model_claude_select',
    'model_openrouter_select',
    'model_custom_select',
    'model_scale_select',
    'model_ai21_select',
    'custom_model_id',
];

const LEGACY_PROFILE_HINT_KEYS = [
    'api_type',
    'apiType',
    'provider',
    'url',
    'baseUrl',
    'base_url',
    'key',
    'apiKey',
    'api_key',
    'model',
    'model_id',
];

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function getSettingsStore() {
    const context = getContextSafe();
    const settingsStore = context?.settings;

    if (settingsStore && typeof settingsStore === 'object') {
        return settingsStore;
    }

    if (globalThis.settings && typeof globalThis.settings === 'object') {
        return globalThis.settings;
    }

    return null;
}

function getPresetDisplayName(raw, fallback = '未命名配置') {
    const candidates = [
        raw?.name,
        raw?.title,
        raw?.display_name,
        raw?.profileName,
        raw?.preset,
    ];

    for (const candidate of candidates) {
        const text = String(candidate ?? '').trim();
        if (text) {
            return text;
        }
    }

    return fallback;
}

function selectorToSettingKey(selector) {
    const raw = String(selector || '').trim();
    if (!raw) return '';

    if (raw.startsWith('#')) {
        return raw.slice(1).trim();
    }

    return raw;
}

function pickSettingKeyFromSelectors(selectors, fallback = '') {
    for (const selector of selectors || []) {
        const key = selectorToSettingKey(selector);
        if (key) {
            return key;
        }
    }

    return String(fallback || '').trim();
}

function hasAnyHintKey(raw, keys) {
    if (!isPlainObject(raw) || !Array.isArray(keys) || keys.length === 0) {
        return false;
    }

    return keys.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
}

function isPresetLikeShape(raw) {
    if (!isPlainObject(raw)) {
        return false;
    }

    if (hasAnyHintKey(raw, PRESET_HINT_KEYS)) {
        return true;
    }

    if (isPlainObject(raw.data) && hasAnyHintKey(raw.data, PRESET_HINT_KEYS)) {
        return true;
    }

    return false;
}

function isLegacyProfileShape(raw) {
    if (!isPlainObject(raw)) {
        return false;
    }

    const hasLegacyHints = hasAnyHintKey(raw, LEGACY_PROFILE_HINT_KEYS);
    const hasPresetHints = hasAnyHintKey(raw, PRESET_HINT_KEYS);
    return hasLegacyHints && !hasPresetHints;
}

function convertLegacyProfileToPreset(raw, index = 0) {
    const fallbackName = `兼容导入配置 ${index + 1}`;
    const apiType = normalizeApiType(raw.api_type || raw.apiType || raw.provider || 'openai');
    const meta = getApiMeta(apiType);

    const urlField = pickSettingKeyFromSelectors(
        [...meta.url, ...GENERIC_SELECTORS.url],
        meta.mainApi === 'openai' ? 'openai_reverse_proxy' : `api_url_${apiType}`,
    );
    const keyField = pickSettingKeyFromSelectors(
        [...meta.key, ...GENERIC_SELECTORS.key],
        `api_key_${apiType}`,
    );
    const modelField = pickSettingKeyFromSelectors(
        [...meta.model, ...GENERIC_SELECTORS.model],
        `model_${apiType}_select`,
    );

    const url = String(raw.url || raw.baseUrl || raw.base_url || '').trim();
    const key = decryptKey(String(raw.key || raw.apiKey || raw.api_key || '').trim());
    const model = String(raw.model || raw.model_id || '').trim();

    const preset = {
        id: String(raw.id || ''),
        name: getPresetDisplayName(raw, fallbackName),
        main_api: meta.mainApi,
        api_type: apiType,
    };

    if (meta.mainApi === 'openai' && meta.source) {
        preset.chat_completion_source = meta.source;
    } else if (meta.mainApi === 'textgenerationwebui') {
        preset.textgen_type = meta.source || apiType;
    }

    if (url && urlField) {
        preset[urlField] = url;
    }

    if (key && keyField) {
        preset[keyField] = key;
    }

    if (model && modelField) {
        preset[modelField] = model;
        if (modelField.endsWith('_select')) {
            preset[modelField.replace(/_select$/, '')] = model;
        }
    }

    return preset;
}

function normalizeImportedEntries(imported) {
    let convertedLegacyCount = 0;
    let skippedCount = 0;

    const entries = imported.entries
        .map((entry, index) => {
            if (!entry || !isPlainObject(entry.raw)) {
                skippedCount += 1;
                return null;
            }

            let raw = deepClone(entry.raw);

            if (isLegacyProfileShape(raw)) {
                raw = convertLegacyProfileToPreset(raw, index);
                convertedLegacyCount += 1;
            } else if (isPlainObject(raw.data) && isLegacyProfileShape(raw.data)) {
                raw = {
                    ...raw,
                    data: convertLegacyProfileToPreset(raw.data, index),
                };

                if (!raw.name && raw.data?.name) {
                    raw.name = raw.data.name;
                }

                convertedLegacyCount += 1;
            }

            if (!isPresetLikeShape(raw)) {
                skippedCount += 1;
                return null;
            }

            const fallbackName = getPresetDisplayName(raw, getPresetDisplayName(raw.data, `配置 ${index + 1}`));
            const resolvedName = String(entry.name || '').trim() || fallbackName;
            const resolvedKey = String(
                entry.key
                || raw.id
                || raw.name
                || raw.data?.id
                || raw.data?.name
                || index,
            ).trim() || String(index);

            return {
                ...entry,
                key: resolvedKey,
                name: resolvedName,
                raw,
            };
        })
        .filter(Boolean);

    return {
        ...imported,
        entries,
        convertedLegacyCount,
        skippedCount,
    };
}

function normalizeArrayPresetEntries(arrayValue) {
    return arrayValue
        .map((item, index) => {
            if (!isPlainObject(item)) {
                return null;
            }

            const wrappedData = isPlainObject(item.data) && Object.keys(item).length <= 2
                ? item.data
                : item;
            const raw = deepClone(wrappedData);

            if (!Object.keys(raw).length) {
                return null;
            }

            const name = getPresetDisplayName(item, getPresetDisplayName(raw, `配置 ${index + 1}`));
            const key = String(item.id ?? raw.id ?? item.name ?? raw.name ?? index);

            return {
                key,
                name,
                raw,
                optionValue: String(item.id ?? raw.id ?? index),
            };
        })
        .filter(Boolean);
}

function normalizeObjectPresetEntries(objectValue) {
    return Object.entries(objectValue)
        .map(([key, value], index) => {
            if (!isPlainObject(value)) {
                return null;
            }

            const wrappedData = isPlainObject(value.data) && Object.keys(value).length <= 2
                ? value.data
                : value;
            const raw = deepClone(wrappedData);

            if (!Object.keys(raw).length) {
                return null;
            }

            return {
                key: String(key),
                name: getPresetDisplayName(value, getPresetDisplayName(raw, key || `配置 ${index + 1}`)),
                raw,
                optionValue: String(key),
            };
        })
        .filter(Boolean);
}

function buildPresetDescriptor(rawValue, kind, commit, options = {}) {
    const storageKind = Array.isArray(rawValue) ? 'array' : 'object';
    const entries = storageKind === 'array'
        ? normalizeArrayPresetEntries(rawValue)
        : normalizeObjectPresetEntries(rawValue);

    return {
        kind,
        rawValue,
        storageKind,
        entries,
        commit,
        getSelectionValue: options.getSelectionValue,
        setSelectionValue: options.setSelectionValue,
        placeholderText: options.placeholderText,
    };
}

function getPresetDescriptor() {
    const settingsStore = getSettingsStore();

    if (Array.isArray(settingsStore?.api_presets) || isPlainObject(settingsStore?.api_presets)) {
        return buildPresetDescriptor(
            settingsStore.api_presets,
            'settings.api_presets',
            (nextValue) => {
                settingsStore.api_presets = nextValue;
            },
        );
    }

    if (Array.isArray(settingsStore?.apiPresets) || isPlainObject(settingsStore?.apiPresets)) {
        return buildPresetDescriptor(
            settingsStore.apiPresets,
            'settings.apiPresets',
            (nextValue) => {
                settingsStore.apiPresets = nextValue;
            },
        );
    }

    const extensionStore = getExtensionSettingsStore();

    if (Array.isArray(extensionStore?.connectionManager?.profiles)) {
        return buildPresetDescriptor(
            extensionStore.connectionManager.profiles,
            'extension_settings.connectionManager.profiles',
            (nextValue) => {
                extensionStore.connectionManager.profiles = nextValue;
            },
            {
                getSelectionValue: () => String(extensionStore.connectionManager.selectedProfile ?? ''),
                setSelectionValue: (value) => {
                    extensionStore.connectionManager.selectedProfile = value || null;
                },
                placeholderText: '<None>',
            },
        );
    }

    if (Array.isArray(extensionStore?.api_profiles?.profiles)) {
        return buildPresetDescriptor(
            extensionStore.api_profiles.profiles,
            'extension_settings.api_profiles.profiles',
            (nextValue) => {
                extensionStore.api_profiles.profiles = nextValue;
            },
            {
                getSelectionValue: () => String(extensionStore.api_profiles.active_profile_id ?? ''),
                setSelectionValue: (value) => {
                    extensionStore.api_profiles.active_profile_id = value || null;
                },
            },
        );
    }

    return null;
}

function resolvePresetPanelHost() {
    for (const selector of PRESET_PANEL_SELECTORS) {
        const element = document.querySelector(selector);
        if (element) {
            return { element, selector };
        }
    }

    return { element: null, selector: '' };
}

function createPresetToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = PRESET_DOM.toolbarId;
    toolbar.className = 'api-manager-toolbar api-manager-injected-toolbar';
    toolbar.innerHTML = `
        <div class="api-manager-search-row">
            <input id="${PRESET_DOM.searchId}" type="search" placeholder="搜索配置..." />
            <button type="button" id="${PRESET_DOM.searchClearId}" class="api-manager-search-clear-btn" aria-label="清空搜索" title="清空搜索">×</button>
            <div id="${PRESET_DOM.searchResultsId}" class="api-manager-search-results" hidden></div>
        </div>
        <div class="api-manager-select-row">
            <div class="api-manager-select-host"></div>
            <div class="api-manager-button-group">
                <button type="button" id="${PRESET_DOM.importButtonId}" class="menu_button">导入</button>
                <button type="button" id="${PRESET_DOM.exportButtonId}" class="menu_button">导出</button>
            </div>
            <div class="api-manager-native-actions"></div>
        </div>
        <input id="${PRESET_DOM.fileInputId}" type="file" accept=".json,application/json" hidden>
        <div id="${PRESET_DOM.statusId}" class="api-manager-status"></div>
    `;
    return toolbar;
}

function moveNativeActionButtonsIntoToolbar(select, toolbar) {
    const nativeActionHost = toolbar.querySelector('.api-manager-native-actions');
    if (!(nativeActionHost instanceof HTMLElement)) {
        return;
    }

    const rowContainer = toolbar.parentElement;
    if (!(rowContainer instanceof HTMLElement)) {
        return;
    }

    const actionButtons = Array.from(rowContainer.children).filter((child) => {
        if (!(child instanceof HTMLElement)) {
            return false;
        }

        if (child === toolbar || child === select) {
            return false;
        }

        return child.classList.contains('menu_button');
    });

    actionButtons.forEach((button) => {
        nativeActionHost.appendChild(button);
    });
}

function setPresetStatus(message, tone = 'info') {
    const status = document.getElementById(PRESET_DOM.statusId);
    if (!status) {
        return;
    }

    status.textContent = String(message || '');
    status.dataset.state = tone;
}

function getPresetOptionValue(descriptor, entry, index) {
    if (descriptor.kind === 'extension_settings.connectionManager.profiles') {
        return String(entry.raw?.id ?? entry.optionValue ?? index);
    }

    if (descriptor.storageKind === 'object') {
        return String(entry.optionValue ?? entry.key ?? index);
    }

    return String(entry.raw?.id ?? entry.optionValue ?? index);
}

function updatePresetSelectStatus(select, visibleCount = null, totalCount = null) {
    if (!(select instanceof HTMLSelectElement)) {
        setPresetStatus('未检测到配置列表');
        return;
    }

    const allOptions = Array.from(select.options);
    const shownCount = visibleCount ?? allOptions.filter((option) => !option.hidden).length;
    const allCount = totalCount ?? allOptions.length;
    const selectedText = String(select.selectedOptions?.[0]?.textContent || '').trim();
    const parts = [`显示 ${shownCount} / ${allCount} 条配置`];

    if (selectedText) {
        parts.push(`当前：${selectedText}`);
    }

    setPresetStatus(parts.join(' · '));
}

function getFirstVisibleSelectablePresetOption(select) {
    if (!(select instanceof HTMLSelectElement)) {
        return null;
    }

    return Array.from(select.options).find((option) => (
        !option.hidden
        && option.style.display !== 'none'
        && !option.disabled
        && String(option.value || '').trim() !== ''
    )) || null;
}

function getPresetSearchResultsContainer(toolbar = null) {
    const host = toolbar instanceof HTMLElement
        ? toolbar
        : document.getElementById(PRESET_DOM.toolbarId);

    if (!(host instanceof HTMLElement)) {
        return null;
    }

    const element = host.querySelector(`#${PRESET_DOM.searchResultsId}`);
    return element instanceof HTMLElement ? element : null;
}

function hidePresetSearchResults(toolbar = null) {
    const resultBox = getPresetSearchResultsContainer(toolbar);
    if (!(resultBox instanceof HTMLElement)) {
        return;
    }

    resultBox.hidden = true;
    resultBox.innerHTML = '';
    resultBox.dataset.activeIndex = '-1';
}

function setActivePresetSearchResult(resultBox, nextIndex) {
    if (!(resultBox instanceof HTMLElement)) {
        return null;
    }

    const items = Array.from(resultBox.querySelectorAll('.api-manager-search-result-item'));
    if (!items.length) {
        resultBox.dataset.activeIndex = '-1';
        return null;
    }

    const parsedIndex = Number(nextIndex);
    const boundedIndex = Number.isFinite(parsedIndex)
        ? Math.max(0, Math.min(items.length - 1, parsedIndex))
        : 0;

    items.forEach((item, index) => {
        item.classList.toggle('is-active', index === boundedIndex);
    });

    resultBox.dataset.activeIndex = String(boundedIndex);
    const active = items[boundedIndex];
    active.scrollIntoView({ block: 'nearest' });
    return active;
}

function commitPresetSearchResult(select, optionIndex, toolbar = null) {
    if (!(select instanceof HTMLSelectElement)) {
        return false;
    }

    const index = Number(optionIndex);
    if (!Number.isInteger(index) || index < 0 || index >= select.options.length) {
        return false;
    }

    const option = select.options[index];
    if (!(option instanceof HTMLOptionElement) || option.disabled || String(option.value || '').trim() === '') {
        return false;
    }

    select.value = String(option.value ?? '');
    select.focus();
    select.dispatchEvent(new Event('change', { bubbles: true }));
    clearPresetSearchKeyword(select, toolbar);
    hidePresetSearchResults(toolbar);
    return true;
}

function renderPresetSearchResults(toolbar, normalizedKeyword, matchedEntries) {
    const resultBox = getPresetSearchResultsContainer(toolbar);
    if (!(resultBox instanceof HTMLElement)) {
        return;
    }

    const hasKeyword = Boolean(String(normalizedKeyword || '').trim());
    if (!hasKeyword) {
        hidePresetSearchResults(toolbar);
        return;
    }

    const limited = matchedEntries.slice(0, PRESET_SEARCH_MAX_RESULTS);
    if (!limited.length) {
        resultBox.hidden = false;
        resultBox.dataset.activeIndex = '-1';
        resultBox.innerHTML = '<div class="api-manager-search-result-empty">无匹配配置</div>';
        return;
    }

    resultBox.hidden = false;
    resultBox.dataset.activeIndex = '0';
    resultBox.innerHTML = limited.map((entry, index) => `
        <button
            type="button"
            class="api-manager-search-result-item${index === 0 ? ' is-active' : ''}"
            data-option-index="${entry.optionIndex}"
            title="${escapeHtml(entry.label)}"
        >
            <span class="api-manager-search-result-label">${escapeHtml(entry.label)}</span>
        </button>
    `).join('');
}

function bindPresetGlobalEvents() {
    if (state.presetGlobalEventsBound) {
        return;
    }

    state.presetGlobalEventsBound = true;

    document.addEventListener('pointerdown', (event) => {
        const toolbar = document.getElementById(PRESET_DOM.toolbarId);
        if (!(toolbar instanceof HTMLElement)) {
            return;
        }

        if (toolbar.contains(event.target)) {
            return;
        }

        hidePresetSearchResults(toolbar);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }

        const toolbar = document.getElementById(PRESET_DOM.toolbarId);
        hidePresetSearchResults(toolbar);
    });
}

function syncPresetSelectPresentation(select) {
    if (!(select instanceof HTMLSelectElement)) {
        return;
    }

    // 保持原生下拉为单行，搜索结果通过独立浮层展示，避免顶开布局。
    select.size = PRESET_SELECT_EXPAND_MIN_ROWS;
    select.classList.remove('api-manager-select-expanded');
}

function applyPresetSearchFilter(select, keyword = state.searchKeyword, toolbar = null) {
    if (!(select instanceof HTMLSelectElement)) {
        hidePresetSearchResults(toolbar);
        return;
    }

    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    let visibleCount = 0;
    let totalCount = 0;
    const matchedEntries = [];

    Array.from(select.options).forEach((option, optionIndex) => {
        const text = String(option.textContent || '').trim().toLowerCase();
        const valueText = String(option.value || '').trim().toLowerCase();
        const matched = !normalizedKeyword || `${text} ${valueText}`.includes(normalizedKeyword);

        option.hidden = !matched;
        option.style.display = matched ? '' : 'none';
        option.classList.toggle('api-manager-hidden-option', !matched);

        totalCount += 1;
        if (matched) {
            visibleCount += 1;

            if (!option.disabled && String(option.value || '').trim() !== '') {
                matchedEntries.push({
                    optionIndex,
                    label: String(option.textContent || option.value || '').trim() || `配置 ${optionIndex + 1}`,
                });
            }
        }
    });

    if (normalizedKeyword && matchedEntries.length) {
        const selectedIndex = Number(select.selectedIndex);
        const hasMatchedSelection = matchedEntries.some((entry) => entry.optionIndex === selectedIndex);

        if (!hasMatchedSelection) {
            select.selectedIndex = matchedEntries[0].optionIndex;
        }
    }

    syncPresetSelectPresentation(select);
    renderPresetSearchResults(toolbar, normalizedKeyword, matchedEntries);

    updatePresetSelectStatus(select, visibleCount, totalCount);

    if (normalizedKeyword && !matchedEntries.length) {
        setPresetStatus(`未找到匹配配置：${keyword}`, 'warning');
    }
}

function clearPresetSearchKeyword(select, toolbar = null) {
    state.searchKeyword = '';

    const host = toolbar instanceof HTMLElement
        ? toolbar
        : document.getElementById(PRESET_DOM.toolbarId);
    const searchInput = host?.querySelector(`#${PRESET_DOM.searchId}`) || document.getElementById(PRESET_DOM.searchId);

    if (searchInput instanceof HTMLInputElement) {
        searchInput.value = '';
    }

    syncPresetSearchClearButton(toolbar);

    if (select instanceof HTMLSelectElement) {
        applyPresetSearchFilter(select, '', toolbar);
    }
}

function syncPresetSearchClearButton(toolbar = null) {
    const host = toolbar instanceof HTMLElement
        ? toolbar
        : document.getElementById(PRESET_DOM.toolbarId);
    const clearButton = host?.querySelector(`#${PRESET_DOM.searchClearId}`) || document.getElementById(PRESET_DOM.searchClearId);

    if (!(clearButton instanceof HTMLButtonElement)) {
        return;
    }

    const hasKeyword = Boolean(String(state.searchKeyword || '').trim());
    clearButton.classList.toggle('is-visible', hasKeyword);
    clearButton.disabled = !hasKeyword;
}

function bindPresetToolbarEvents(toolbar) {
    const searchInput = /** @type {HTMLInputElement | null} */ (toolbar.querySelector(`#${PRESET_DOM.searchId}`));
    const clearSearchButton = /** @type {HTMLButtonElement | null} */ (toolbar.querySelector(`#${PRESET_DOM.searchClearId}`));
    const searchResults = /** @type {HTMLElement | null} */ (toolbar.querySelector(`#${PRESET_DOM.searchResultsId}`));
    const importButton = /** @type {HTMLButtonElement | null} */ (toolbar.querySelector(`#${PRESET_DOM.importButtonId}`));
    const exportButton = /** @type {HTMLButtonElement | null} */ (toolbar.querySelector(`#${PRESET_DOM.exportButtonId}`));
    const fileInput = /** @type {HTMLInputElement | null} */ (toolbar.querySelector(`#${PRESET_DOM.fileInputId}`));

    bindPresetGlobalEvents();

    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        searchInput.value = state.searchKeyword;

        searchInput.addEventListener('focus', () => {
            const select = resolvePresetSelect(resolvePresetPanelHost().element || document);
            applyPresetSearchFilter(select, state.searchKeyword, toolbar);
        });

        searchInput.addEventListener('input', (event) => {
            const input = /** @type {HTMLInputElement} */ (event.currentTarget);
            state.searchKeyword = String(input.value || '');
            applyPresetSearchFilter(resolvePresetSelect(resolvePresetPanelHost().element || document), state.searchKeyword, toolbar);
            syncPresetSearchClearButton(toolbar);
        });

        searchInput.addEventListener('keydown', (event) => {
            const resultBox = getPresetSearchResultsContainer(toolbar);
            const hasKeyword = Boolean(String(state.searchKeyword || '').trim());

            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && resultBox && !resultBox.hidden) {
                const buttons = Array.from(resultBox.querySelectorAll('.api-manager-search-result-item'));
                if (!buttons.length) {
                    return;
                }

                const delta = event.key === 'ArrowDown' ? 1 : -1;
                const currentIndex = Number(resultBox.dataset.activeIndex ?? -1);
                const nextIndex = currentIndex < 0
                    ? (delta > 0 ? 0 : buttons.length - 1)
                    : Math.max(0, Math.min(buttons.length - 1, currentIndex + delta));

                setActivePresetSearchResult(resultBox, nextIndex);
                event.preventDefault();
                return;
            }

            if (event.key === 'Escape') {
                hidePresetSearchResults(toolbar);
                return;
            }

            if (event.key !== 'Enter') {
                return;
            }

            if (!hasKeyword) {
                return;
            }

            const select = resolvePresetSelect(resolvePresetPanelHost().element || document);
            if (!(select instanceof HTMLSelectElement)) {
                return;
            }

            if (resultBox && !resultBox.hidden) {
                const activeIndex = Number(resultBox.dataset.activeIndex ?? 0);
                const activeButton = resultBox.querySelectorAll('.api-manager-search-result-item')[activeIndex]
                    || resultBox.querySelector('.api-manager-search-result-item');

                if (activeButton instanceof HTMLButtonElement) {
                    const optionIndex = Number(activeButton.dataset.optionIndex);
                    if (commitPresetSearchResult(select, optionIndex, toolbar)) {
                        event.preventDefault();
                        return;
                    }
                }
            }

            const firstOption = getFirstVisibleSelectablePresetOption(select);
            if (firstOption) {
                select.value = String(firstOption.value ?? '');
                select.focus();
                select.dispatchEvent(new Event('change', { bubbles: true }));
                clearPresetSearchKeyword(select, toolbar);
                hidePresetSearchResults(toolbar);
                event.preventDefault();
            }
        });
    }

    if (searchResults && !searchResults.dataset.bound) {
        searchResults.dataset.bound = '1';

        searchResults.addEventListener('mousedown', (event) => {
            // 防止点击候选项时搜索框失焦导致浮层闪烁
            event.preventDefault();
        });

        searchResults.addEventListener('mousemove', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('.api-manager-search-result-item')
                : null;

            if (!(target instanceof HTMLButtonElement)) {
                return;
            }

            const items = Array.from(searchResults.querySelectorAll('.api-manager-search-result-item'));
            const hitIndex = items.indexOf(target);
            if (hitIndex >= 0) {
                setActivePresetSearchResult(searchResults, hitIndex);
            }
        });

        searchResults.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('.api-manager-search-result-item')
                : null;

            if (!(target instanceof HTMLButtonElement)) {
                return;
            }

            const select = resolvePresetSelect(resolvePresetPanelHost().element || document);
            if (!(select instanceof HTMLSelectElement)) {
                return;
            }

            const optionIndex = Number(target.dataset.optionIndex);
            commitPresetSearchResult(select, optionIndex, toolbar);
        });
    }

    if (clearSearchButton && !clearSearchButton.dataset.bound) {
        clearSearchButton.dataset.bound = '1';
        clearSearchButton.addEventListener('click', () => {
            const select = resolvePresetSelect(resolvePresetPanelHost().element || document);
            clearPresetSearchKeyword(select, toolbar);
            searchInput?.focus();
        });
    }

    if (exportButton && !exportButton.dataset.bound) {
        exportButton.dataset.bound = '1';
        exportButton.addEventListener('click', () => {
            exportProfiles();
        });
    }

    if (importButton && !importButton.dataset.bound) {
        importButton.dataset.bound = '1';
        importButton.addEventListener('click', () => {
            if (fileInput instanceof HTMLInputElement) {
                fileInput.value = '';
                fileInput.click();
            }
        });
    }

    if (fileInput && !fileInput.dataset.bound) {
        fileInput.dataset.bound = '1';
        fileInput.addEventListener('change', async (event) => {
            const input = /** @type {HTMLInputElement} */ (event.currentTarget);
            const file = input.files?.[0];
            await importProfiles(file);
            input.value = '';
        });
    }
}

/**
 * @param {Document | Element | null | undefined} root
 * @returns {HTMLSelectElement | null}
 */
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
    }) || candidates.find((select) => {
        const ignoredIds = ['main_api', 'chat_completion_source', 'textgen_type'];
        return select.options.length > 1 && !ignoredIds.includes(select.id);
    }) || null;
}

function bindPresetSelectEvents(select) {
    if (!(select instanceof HTMLSelectElement) || select.dataset.apiManagerBound === '1') {
        return;
    }

    select.dataset.apiManagerBound = '1';
    select.addEventListener('change', (event) => {
        updatePresetSelectStatus(select);

        // 用户已经完成一次选择时，自动清空搜索词，恢复完整列表展示。
        if (event.isTrusted && String(state.searchKeyword || '').trim()) {
            const toolbar = document.getElementById(PRESET_DOM.toolbarId);
            clearPresetSearchKeyword(select, toolbar);
        }
    });
}

function refreshPresetSelect(select) {
    const descriptor = getPresetDescriptor();
    if (!descriptor || !(select instanceof HTMLSelectElement)) {
        return;
    }

    const previousValue = String(select.value ?? '');
    const previousPlaceholder = Array.from(select.options).find((option) => option.value === '');
    const placeholderText = previousPlaceholder?.textContent?.trim() || descriptor.placeholderText || '';

    select.innerHTML = '';

    if (placeholderText) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = placeholderText;
        select.appendChild(option);
    }

    descriptor.entries.forEach((entry, index) => {
        const option = document.createElement('option');
        option.value = getPresetOptionValue(descriptor, entry, index);
        option.textContent = entry.name;
        select.appendChild(option);
    });

    const preferredValue = previousValue
        || String(descriptor.getSelectionValue?.() ?? '');
    const hasPreferred = Array.from(select.options).some((option) => option.value === preferredValue);

    if (hasPreferred) {
        select.value = preferredValue;
    } else if (placeholderText) {
        select.value = '';
    }

    bindPresetSelectEvents(select);
    const toolbar = document.getElementById(PRESET_DOM.toolbarId);
    applyPresetSearchFilter(select, state.searchKeyword, toolbar);
}

function extractCollectionValue(source, depth = 0) {
    if (depth > 4) {
        return null;
    }

    if (Array.isArray(source)) {
        return source;
    }

    if (!isPlainObject(source)) {
        return null;
    }

    const candidateKeys = ['api_presets', 'apiPresets', 'presets', 'profiles', 'api_profiles'];
    for (const key of candidateKeys) {
        const nested = extractCollectionValue(source[key], depth + 1);
        if (nested) {
            return nested;
        }
    }

    const entries = Object.entries(source);
    if (entries.length > 0 && entries.every(([, value]) => isPlainObject(value) || (isPlainObject(value?.data) && Object.keys(value).length <= 2))) {
        return source;
    }

    return null;
}

function normalizeImportedPresetPayload(parsed) {
    const collection = extractCollectionValue(parsed);

    if (!collection) {
        throw new Error('导入文件中未找到可识别的 API 配置集合');
    }

    const entries = Array.isArray(collection)
        ? normalizeArrayPresetEntries(collection)
        : normalizeObjectPresetEntries(collection);

    if (!entries.length) {
        throw new Error('导入文件中没有有效的 API 配置对象');
    }

    return {
        storageKind: Array.isArray(collection) ? 'array' : 'object',
        rawValue: collection,
        entries,
    };
}

function getPresetIdentity(raw, fallback = '') {
    return String(
        raw?.id
        ?? raw?.name
        ?? raw?.title
        ?? raw?.preset
        ?? fallback,
    ).trim();
}

function mergeImportedPresetData(descriptor, imported) {
    if (descriptor.storageKind === 'object') {
        const nextValue = isPlainObject(descriptor.rawValue) ? deepClone(descriptor.rawValue) : {};

        imported.entries.forEach((entry, index) => {
            const key = String(entry.key || entry.name || `preset_${index + 1}`).trim() || `preset_${index + 1}`;
            const raw = deepClone(entry.raw);

            if (!raw.name && entry.name) {
                raw.name = entry.name;
            }

            nextValue[key] = raw;
        });

        descriptor.commit(nextValue);
        return imported.entries.length;
    }

    const nextValue = Array.isArray(descriptor.rawValue)
        ? descriptor.rawValue.map((item) => deepClone(item))
        : [];

    imported.entries.forEach((entry, index) => {
        const raw = deepClone(entry.raw);

        if (!raw.name && entry.name) {
            raw.name = entry.name;
        }

        const incomingIdentity = getPresetIdentity(raw, entry.name || String(index));
        const hitIndex = nextValue.findIndex((existing, existingIndex) => {
            const existingIdentity = getPresetIdentity(existing, String(existingIndex));
            return !!incomingIdentity && incomingIdentity === existingIdentity;
        });

        if (hitIndex >= 0) {
            nextValue[hitIndex] = { ...nextValue[hitIndex], ...raw };
        } else {
            nextValue.push(raw);
        }
    });

    descriptor.commit(nextValue);
    return imported.entries.length;
}

function ensurePresetToolbar() {
    const { element: panel } = resolvePresetPanelHost();
    const select = resolvePresetSelect(panel || document);

    if (!(select instanceof HTMLSelectElement)) {
        return false;
    }

    let toolbar = document.getElementById(PRESET_DOM.toolbarId);
    if (toolbar && panel && !panel.contains(toolbar)) {
        toolbar.remove();
        toolbar = null;
    }

    if (!toolbar) {
        toolbar = createPresetToolbar();
        select.parentElement?.insertBefore(toolbar, select);
    }

    bindPresetToolbarEvents(toolbar);

    const selectHost = toolbar.querySelector('.api-manager-select-host');
    if (selectHost && select.parentElement !== selectHost) {
        selectHost.appendChild(select);
    }

    moveNativeActionButtonsIntoToolbar(select, toolbar);

    bindPresetSelectEvents(select);
    applyPresetSearchFilter(select, state.searchKeyword, toolbar);
    syncPresetSearchClearButton(toolbar);

    return true;
}

function schedulePresetToolbarInjection() {
    if (state.presetInjectTimer) {
        clearTimeout(state.presetInjectTimer);
    }

    state.presetInjectTimer = setTimeout(() => {
        ensurePresetToolbar();
    }, 60);
}

async function waitForPresetEnvironmentReady(timeoutMs = 12000) {
    const begin = Date.now();

    while (Date.now() - begin < timeoutMs) {
        if (document.body) {
            return true;
        }

        await sleep(150);
    }

    return false;
}

/**
 * 导出配置 JSON
 */
export function exportProfiles() {
    try {
        const descriptor = getPresetDescriptor();
        if (!descriptor) {
            throw new Error('未找到可导出的 API 配置存储');
        }

        const select = resolvePresetSelect(resolvePresetPanelHost().element || document);
        const payload = {
            version: 1,
            exported_at: new Date().toISOString(),
            source: descriptor.kind,
            selected: select instanceof HTMLSelectElement
                ? {
                    value: String(select.value ?? ''),
                    index: select.selectedIndex,
                    text: String(select.selectedOptions?.[0]?.textContent || '').trim(),
                }
                : null,
            api_presets: deepClone(descriptor.rawValue),
        };
        downloadJson(`api-presets-${Date.now()}.json`, payload);
        toast('success', '配置导出成功');
    } catch (error) {
        logError('导出配置失败', error);
        toast('error', `导出失败：${error.message || error}`);
    }
}

function parseImportedPayload(parsed) {
    if (Array.isArray(parsed)) {
        return {
            version: 1,
            active_profile_id: null,
            profiles: parsed,
            settings: {
                sort_by: 'last_used',
            },
        };
    }

    if (parsed && typeof parsed === 'object') {
        if (parsed.api_profiles && typeof parsed.api_profiles === 'object') {
            return parsed.api_profiles;
        }
        if (Array.isArray(parsed.profiles)) {
            return parsed;
        }
    }

    throw new Error('导入文件格式无效，未找到 profiles 数组');
}

/**
 * 导入配置 JSON（支持合并或替换）
 */
export async function importProfiles(file, mode = 'merge') {
    if (!file) {
        toast('warning', '未选择导入文件');
        return;
    }

    try {
        if (!window.confirm('导入前建议先导出当前配置作为备份，是否继续导入？')) {
            return;
        }

        const descriptor = getPresetDescriptor();
        if (!descriptor) {
            throw new Error('未找到可写入的 API 配置存储');
        }

        const text = await file.text();
        const parsed = JSON.parse(text);
        const importedRaw = normalizeImportedPresetPayload(parsed);
        const imported = normalizeImportedEntries(importedRaw);

        if (!imported.entries.length) {
            throw new Error('导入文件中未检测到可用的 API 预设配置');
        }

        const normalizedMode = mode === 'replace' ? 'replace' : 'merge';
        let importedCount = 0;

        if (normalizedMode === 'replace') {
            const nextValue = descriptor.storageKind === 'array'
                ? imported.entries.map((entry) => deepClone(entry.raw))
                : imported.entries.reduce((acc, entry, index) => {
                    const key = String(entry.key || entry.name || `preset_${index + 1}`).trim() || `preset_${index + 1}`;
                    acc[key] = deepClone(entry.raw);
                    return acc;
                }, {});

            descriptor.commit(nextValue);
            importedCount = imported.entries.length;
        } else {
            importedCount = mergeImportedPresetData(descriptor, imported);
        }

        requestSaveSettings();

        const select = resolvePresetSelect(resolvePresetPanelHost().element || document);
        if (select instanceof HTMLSelectElement) {
            refreshPresetSelect(select);
        }

        const modeText = normalizedMode === 'replace' ? '替换' : '合并';
        const detailParts = [];

        if (imported.convertedLegacyCount > 0) {
            detailParts.push(`兼容转换 ${imported.convertedLegacyCount} 条旧版配置`);
        }

        if (imported.skippedCount > 0) {
            detailParts.push(`跳过 ${imported.skippedCount} 条无效项`);
        }

        const detailText = detailParts.length ? `（${detailParts.join('，')}）` : '';
        setPresetStatus(`${modeText}导入 ${importedCount} 条配置${detailText}`, 'success');
        toast('success', `导入完成（${modeText}）：${importedCount} 条配置${detailText}`);
    } catch (error) {
        logError('导入配置失败', error);
        toast('error', `导入失败：${error.message || error}`);
        setPresetStatus(`导入失败：${error.message || error}`, 'error');
    }
}

function openPanel() {
    $(UI.overlay).addClass('is-open').show();
    renderProfileList();
}

function closePanel() {
    $(UI.overlay).removeClass('is-open').hide();
}

function openImportDialog(mode) {
    state.importMode = mode === 'replace' ? 'replace' : 'merge';
    $(UI.importInput).val('');
    $(UI.importInput).trigger('click');
}

function bindEvents() {
    $(document).off(EVENT_NS);
    $(window).off(EVENT_NS);

    // 视口变化时，实时同步悬浮按钮显隐状态
    $(window).on(`resize${EVENT_NS} scroll${EVENT_NS}`, () => {
        syncFloatingTriggerState();
    });

    $(document).on(`click${EVENT_NS}`, UI.trigger, () => {
        if ($(UI.overlay).is(':visible')) {
            closePanel();
        } else {
            openPanel();
        }
    });

    $(document).on(`click${EVENT_NS}`, '#api-manager-close-btn', closePanel);
    $(document).on(`click${EVENT_NS}`, UI.overlay, (event) => {
        if (event.target.id === 'api-manager-overlay') {
            closePanel();
        }
    });

    $(document).on(`keydown${EVENT_NS}`, (event) => {
        if (event.key === 'Escape') {
            closePanel();
        }
    });

    $(document).on(`input${EVENT_NS}`, UI.search, (event) => {
        const nextKeyword = String($(event.currentTarget).val() || '');
        if (state.searchTimer) {
            clearTimeout(state.searchTimer);
        }

        state.searchTimer = setTimeout(() => {
            state.searchKeyword = nextKeyword;
            renderProfileList();
        }, 200);
    });

    $(document).on(`change${EVENT_NS}`, UI.sort, (event) => {
        const value = String($(event.currentTarget).val() || 'last_used');
        const store = ensureStore();

        state.sortBy = SORT_OPTIONS.includes(value) ? value : 'last_used';
        store.settings.sort_by = state.sortBy;
        saveStore();
        renderProfileList();
    });

    $(document).on(`click${EVENT_NS}`, '#api-manager-save-current-btn', () => {
        saveCurrentAsProfile();
    });

    $(document).on(`click${EVENT_NS}`, '#api-manager-export-btn', () => {
        exportProfiles();
    });

    $(document).on(`click${EVENT_NS}`, '#api-manager-import-merge-btn', () => {
        openImportDialog('merge');
    });

    $(document).on(`click${EVENT_NS}`, '#api-manager-import-replace-btn', () => {
        openImportDialog('replace');
    });

    $(document).on(`change${EVENT_NS}`, UI.importInput, async (event) => {
        const file = event.target.files?.[0];
        await importProfiles(file, state.importMode);
        event.target.value = '';
    });

    $(document).on(`click${EVENT_NS}`, '.api-manager-action-apply', async (event) => {
        const profileId = String($(event.currentTarget).data('id') || '');
        const store = ensureStore();
        const profile = store.profiles.find((item) => item.id === profileId);

        if (!profile) {
            toast('error', '未找到目标配置');
            return;
        }

        try {
            await applyProfile(profile);
        } catch {
            // 已在 applyProfile 中提示
        }
    });

    $(document).on(`click${EVENT_NS}`, '.api-manager-action-overwrite', (event) => {
        const profileId = String($(event.currentTarget).data('id') || '');
        overwriteProfileByCurrent(profileId);
    });

    $(document).on(`click${EVENT_NS}`, '.api-manager-action-delete', (event) => {
        const profileId = String($(event.currentTarget).data('id') || '');
        removeProfile(profileId);
    });
}

function buildPanelHtml() {
    return `
        <div id="api-manager-overlay" class="api-manager-overlay" style="display:none;">
            <div id="api-manager-panel" class="api-manager-panel">
                <div class="api-manager-header">
                    <div class="api-manager-title">API 配置管理</div>
                    <button type="button" id="api-manager-close-btn" class="menu_button api-manager-close-btn">×</button>
                </div>

                <div class="api-manager-toolbar">
                    <input id="api-manager-search" class="text_pole" type="text" placeholder="搜索 名称 / URL / 类型 / 模型（200ms防抖）" />
                    <select id="api-manager-sort" class="text_pole">
                        <option value="last_used">按最近使用</option>
                        <option value="created_at">按创建时间</option>
                        <option value="name">按名称</option>
                    </select>
                    <span id="api-manager-count" class="api-manager-count">共 0 条</span>
                </div>

                <div id="api-manager-list" class="api-manager-list"></div>

                <div class="api-manager-footer">
                    <input id="api-manager-name" class="text_pole" type="text" placeholder="配置名称（留空自动命名）" />
                    <button type="button" id="api-manager-save-current-btn" class="menu_button">保存当前</button>
                    <button type="button" id="api-manager-export-btn" class="menu_button">导出</button>
                    <button type="button" id="api-manager-import-merge-btn" class="menu_button">导入(合并)</button>
                    <button type="button" id="api-manager-import-replace-btn" class="menu_button">导入(替换)</button>
                    <input id="api-manager-import-input" type="file" accept=".json,application/json" hidden>
                </div>
            </div>
        </div>
    `;
}

function ensureFloatingTrigger() {
    if ($(UI.floatingTrigger).length) return;

    $('body').append(`
        <button type="button" id="api-manager-trigger-floating-btn" class="menu_button api-manager-trigger-btn api-manager-trigger-floating" title="API 配置管理">
            <span class="api-manager-trigger-icon">📋</span>
            <span class="api-manager-trigger-label">API管理</span>
        </button>
    `);
}

function syncFloatingTriggerState() {
    const $float = $(UI.floatingTrigger);
    if (!$float.length) return;

    const { $host } = resolveApiPanelHost();

    // 让浮动按钮尽量贴近 API 面板右侧，而不是死贴浏览器右侧
    let rightOffset = 16;
    if ($host && $host.length) {
        const rect = $host.get(0)?.getBoundingClientRect?.();
        if (rect && Number.isFinite(rect.right)) {
            rightOffset = Math.max(12, Math.round(window.innerWidth - rect.right + 12));
        }
    }
    $float.css('right', `${rightOffset}px`);

    // 始终保留悬浮入口，避免标题栏按钮被滚动出视口后“找不到入口”
    $float.removeClass('is-hidden');
}

function getApiUiRoot() {
    const { $host } = resolveApiPanelHost();
    if ($host && $host.length) {
        return $host;
    }

    return $('body');
}

function getVisibleLoadingButtons() {
    const $root = getApiUiRoot();
    let $buttons = $root.find('.api_loading:visible');

    if (!$buttons.length) {
        $buttons = $('.api_loading:visible');
    }

    return $buttons;
}

function getVisibleStatusElements() {
    const $root = getApiUiRoot();
    let $status = $root.find('.online_status_text:visible');

    if (!$status.length) {
        $status = $('.online_status_text:visible');
    }

    if (!$status.length) {
        $status = $('.online_status_text').first();
    }

    return $status;
}

function resolveApiPanelHost() {
    for (const selector of API_PANEL_HOST_SELECTORS) {
        const $host = $(selector).first();
        if ($host.length) {
            return { $host, selector };
        }
    }
    return { $host: null, selector: '' };
}

/**
 * 在 API 设置区注入入口按钮和管理面板（兼容多个酒馆版本）
 */
export function injectUI() {
    const injected = ensurePresetToolbar();
    if (injected) {
        const { selector } = resolvePresetPanelHost();
        log('已注入 API 搜索/导入导出工具栏，宿主：', selector || '(unknown)');
    }

    return injected;
}

function startReinjectWatcher() {
    if (state.reinjectTimer) return;

    state.reinjectTimer = setInterval(() => {
        try {
            schedulePresetToolbarInjection();
        } catch (error) {
            logError('UI 重注入失败', error);
        }
    }, 1200);
}

function bindEventSourceHooks() {
    const context = getContextSafe();
    const source = context?.eventSource || globalThis.eventSource;
    const eventTypes = context?.eventTypes || globalThis.event_types;

    if (!source || typeof source.on !== 'function' || !eventTypes) {
        return;
    }

    const reinjectEvents = [
        eventTypes.APP_READY,
        eventTypes.SETTINGS_UPDATED,
        eventTypes.MAIN_API_CHANGED,
        eventTypes.CHARACTER_MESSAGE_RENDERED,
        eventTypes.CONNECTION_PROFILE_CREATED,
        eventTypes.CONNECTION_PROFILE_UPDATED,
        eventTypes.CONNECTION_PROFILE_DELETED,
        eventTypes.CONNECTION_PROFILE_LOADED,
    ].filter(Boolean);

    reinjectEvents.forEach((eventName) => {
        source.on(eventName, () => {
            schedulePresetToolbarInjection();
        });
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            schedulePresetToolbarInjection();
        }, { once: true });
    }
}

export async function initApiManagerExtension() {
    if (state.initialized) {
        injectUI();
        return;
    }

    try {
        const ready = await waitForPresetEnvironmentReady();
        if (!ready) {
            throw new Error('等待酒馆 API 设置面板超时');
        }

        injectUI();
        bindEventSourceHooks();
        startReinjectWatcher();

        state.initialized = true;
        log('扩展初始化完成');
    } catch (error) {
        logError('初始化失败', error);
        toast('error', `初始化失败：${error.message || error}`);
    }
}
