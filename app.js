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
    ioBusy: false,
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

const CRYPTO_CONFIG = {
    schemaVersion: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 240000,
    keyLength: 256,
    saltLength: 16,
    ivLength: 12,
};

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

function bytesToBase64(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let binary = '';

    for (let index = 0; index < source.length; index += 1) {
        binary += String.fromCharCode(source[index]);
    }

    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function hasWebCryptoSupport() {
    return Boolean(globalThis.crypto?.subtle && typeof globalThis.crypto.getRandomValues === 'function');
}

async function deriveAesKeyFromPassword(password, saltBytes, usages = ['encrypt']) {
    if (!hasWebCryptoSupport()) {
        throw new Error('当前环境不支持 Web Crypto API');
    }

    const subtle = globalThis.crypto.subtle;
    const encoder = new TextEncoder();
    const passwordText = String(password || '');

    const keyMaterial = await subtle.importKey(
        'raw',
        encoder.encode(passwordText),
        { name: CRYPTO_CONFIG.kdf },
        false,
        ['deriveKey'],
    );

    return subtle.deriveKey(
        {
            name: CRYPTO_CONFIG.kdf,
            salt: saltBytes,
            iterations: CRYPTO_CONFIG.iterations,
            hash: CRYPTO_CONFIG.hash,
        },
        keyMaterial,
        { name: CRYPTO_CONFIG.algorithm, length: CRYPTO_CONFIG.keyLength },
        false,
        usages,
    );
}

async function encryptPayloadWithPassword(payload, password) {
    if (!hasWebCryptoSupport()) {
        throw new Error('当前环境不支持 Web Crypto API，无法加密导出');
    }

    const subtle = globalThis.crypto.subtle;
    const encoder = new TextEncoder();

    const salt = globalThis.crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.saltLength));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.ivLength));
    const key = await deriveAesKeyFromPassword(password, salt, ['encrypt']);
    const plainBuffer = encoder.encode(JSON.stringify(payload));
    const cipherBuffer = await subtle.encrypt(
        {
            name: CRYPTO_CONFIG.algorithm,
            iv,
        },
        key,
        plainBuffer,
    );

    return {
        format: 'api-manager-export',
        version: CRYPTO_CONFIG.schemaVersion,
        isEncrypted: true,
        crypto: {
            algorithm: CRYPTO_CONFIG.algorithm,
            kdf: CRYPTO_CONFIG.kdf,
            hash: CRYPTO_CONFIG.hash,
            iterations: CRYPTO_CONFIG.iterations,
            keyLength: CRYPTO_CONFIG.keyLength,
        },
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
    };
}

async function decryptPayloadWithPassword(encryptedPayload, password) {
    if (!hasWebCryptoSupport()) {
        throw new Error('当前环境不支持 Web Crypto API，无法解密导入');
    }

    const subtle = globalThis.crypto.subtle;
    const decoder = new TextDecoder();

    const saltBytes = base64ToBytes(encryptedPayload.salt);
    const ivBytes = base64ToBytes(encryptedPayload.iv);
    const cipherBytes = base64ToBytes(encryptedPayload.ciphertext);

    const key = await deriveAesKeyFromPassword(password, saltBytes, ['decrypt']);
    const plainBuffer = await subtle.decrypt(
        {
            name: CRYPTO_CONFIG.algorithm,
            iv: ivBytes,
        },
        key,
        cipherBytes,
    );

    const plainText = decoder.decode(plainBuffer);
    return JSON.parse(plainText);
}

function isEncryptedExportPayload(payload) {
    return Boolean(
        payload
        && typeof payload === 'object'
        && payload.isEncrypted === true
        && typeof payload.salt === 'string'
        && typeof payload.iv === 'string'
        && typeof payload.ciphertext === 'string',
    );
}

function requestOptionalExportPassword() {
    const shouldEncrypt = window.confirm('是否需要设置访问密码？\n点击“确定”将使用密码加密导出；点击“取消”则导出普通 JSON。');
    if (!shouldEncrypt) {
        return { cancelled: false, password: '' };
    }

    const firstInput = window.prompt('请输入访问密码（留空则导出普通 JSON）：', '');
    if (firstInput === null) {
        return { cancelled: true, password: '' };
    }

    const password = String(firstInput || '');
    if (!password) {
        return { cancelled: false, password: '' };
    }

    if (password.length < 6) {
        throw new Error('访问密码至少需要 6 位');
    }

    const confirmInput = window.prompt('请再次输入访问密码：', '');
    if (confirmInput === null) {
        return { cancelled: true, password: '' };
    }

    if (password !== String(confirmInput || '')) {
        throw new Error('两次输入的访问密码不一致');
    }

    return { cancelled: false, password };
}

function requestImportPassword() {
    const input = window.prompt('检测到加密导出文件，请输入访问密码：', '');
    if (input === null) {
        return null;
    }

    const password = String(input || '');
    return password || null;
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

function readSettingsValue(settingsStore, fields, options = {}) {
    const { nonEmptyOnly = false } = options;

    if (!settingsStore || typeof settingsStore !== 'object') {
        return '';
    }

    for (const field of fields) {
        if (!field) continue;

        const rawValue = settingsStore[field];
        if (rawValue === undefined || rawValue === null) continue;

        const value = String(rawValue).trim();
        if (nonEmptyOnly && !value) continue;
        return value;
    }

    return '';
}

function resolveTypeKeyFromRuntime(apiType) {
    const getTypeKey = globalAny.getTypeKey || globalThis.getTypeKey;
    if (typeof getTypeKey !== 'function') {
        return '';
    }

    const normalizedType = normalizeApiType(apiType);
    const argCandidates = [
        [],
        [normalizedType],
        [`api_key_${normalizedType}`],
    ];

    if (normalizedType === 'custom') {
        argCandidates.unshift(
            ['custom'],
            ['api_key_custom'],
        );
    }

    for (const args of argCandidates) {
        try {
            const value = getTypeKey(...args);
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        } catch (error) {
            // 兼容不同版本 getTypeKey 的参数签名，失败时继续尝试。
        }
    }

    return '';
}

function resolveConfigFromSettings(apiType) {
    const normalizedType = normalizeApiType(apiType);
    const settingsStore = getSettingsStore();

    const rawKey = readSettingsValue(
        settingsStore,
        normalizedType === 'custom'
            ? ['api_key_custom']
            : [`api_key_${normalizedType}`],
    );

    let key = resolveTypeKeyFromRuntime(normalizedType)
        || rawKey;

    if (normalizedType === 'custom' && rawKey) {
        const plainCustomKey = resolvePlainTextCustomKey(rawKey);
        if (plainCustomKey) {
            key = plainCustomKey;
        }
    }

    const url = readSettingsValue(
        settingsStore,
        normalizedType === 'custom'
            ? ['api_url_custom']
            : [`api_url_${normalizedType}`, `${normalizedType}_api_url`],
        { nonEmptyOnly: true },
    );

    return { key, url };
}

function getSecretsStore() {
    const secretsStore = window?.secrets || globalAny.secrets || globalThis.secrets;
    if (secretsStore && typeof secretsStore === 'object') {
        return secretsStore;
    }

    return null;
}

async function getRealSecret(id) {
    const secretId = String(id || '').trim();
    if (!secretId) {
        return null;
    }

    // 1. 尝试全自动：从酒馆内存抓取
    const stSecrets = window?.secrets || globalThis.secrets || {};
    if (stSecrets[secretId] && stSecrets[secretId].length > 15) {
        return stSecrets[secretId];
    }

    // 2. 尝试缓存：从插件 localStorage 抓取
    const cached = localStorage.getItem(`faxrd9_key_${secretId}`);
    if (cached) {
        return cached;
    }

    return null; // 抓不到，标记为需要手动补全
}

function isSecretIdField(fieldName) {
    const name = String(fieldName || '').trim();
    return ['secret-id', 'secret_id', 'secretId', 'api_key_custom'].includes(name);
}

function shouldTreatAsSecretId(fieldName, value) {
    const text = String(value || '').trim();
    if (!text) {
        return false;
    }

    if (fieldName === 'api_key_custom') {
        return isLikelySecretId(text);
    }

    return true;
}

function dedupeMissingSecretRefs(missingRefs = []) {
    const map = new Map();

    missingRefs.forEach((item) => {
        const secretId = String(item?.secretId || '').trim();
        if (!secretId) {
            return;
        }

        if (!map.has(secretId)) {
            map.set(secretId, {
                secretId,
                names: new Set(),
                fields: new Set(),
            });
        }

        const current = map.get(secretId);
        current.names.add(String(item?.presetName || '未命名配置').trim() || '未命名配置');
        current.fields.add(String(item?.field || 'secret-id').trim() || 'secret-id');
    });

    return Array.from(map.values()).map((item) => ({
        secretId: item.secretId,
        names: Array.from(item.names),
        fields: Array.from(item.fields),
    }));
}

async function requestManualSecretsBeforeExport(missingRefs = []) {
    const refs = dedupeMissingSecretRefs(missingRefs);
    if (!refs.length) {
        return true;
    }

    return new Promise((resolve) => {
        const existing = document.getElementById('api-manager-secret-fill-overlay');
        if (existing) {
            existing.remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'api-manager-secret-fill-overlay';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'background:rgba(0,0,0,.55)',
            'z-index:99999',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:12px',
        ].join(';');

        const panel = document.createElement('div');
        panel.style.cssText = [
            'width:min(92vw,640px)',
            'max-height:85vh',
            'overflow:auto',
            'background:var(--SmartThemeBlurTintColor, #1f1f1f)',
            'border:1px solid var(--SmartThemeBorderColor, #444)',
            'border-radius:10px',
            'padding:14px',
            'color:var(--SmartThemeBodyColor, #fff)',
            'box-shadow:0 10px 30px rgba(0,0,0,.35)',
        ].join(';');

        const rows = refs.map((item, index) => {
            const title = item.names.join(' / ');
            const fieldText = item.fields.join(', ');

            return `
                <div style="padding:10px 0;border-bottom:1px dashed rgba(255,255,255,.15)">
                    <div style="font-size:13px;opacity:.9;margin-bottom:6px;">#${index + 1} ${escapeHtml(title)}</div>
                    <div style="font-size:12px;opacity:.75;margin-bottom:8px;">字段：${escapeHtml(fieldText)} ｜ secret-id：${escapeHtml(item.secretId)}</div>
                    <input
                        type="text"
                        data-secret-id="${escapeHtml(item.secretId)}"
                        class="text_pole"
                        style="width:100%;box-sizing:border-box;"
                        placeholder="请输入该项明文 API Key"
                    />
                </div>
            `;
        }).join('');

        panel.innerHTML = `
            <div style="font-size:16px;font-weight:600;margin-bottom:8px;">导出前需补全密钥</div>
            <div style="font-size:13px;opacity:.85;line-height:1.5;margin-bottom:10px;">
                检测到 ${refs.length} 项密钥无法自动解密。请填写后再导出（支持手机粘贴）。
            </div>
            ${rows}
            <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:12px;">
                <button type="button" id="api-manager-secret-fill-cancel" class="menu_button">取消导出</button>
                <button type="button" id="api-manager-secret-fill-save" class="menu_button">保存并继续导出</button>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const cleanup = () => {
            overlay.remove();
        };

        const cancelButton = panel.querySelector('#api-manager-secret-fill-cancel');
        const saveButton = panel.querySelector('#api-manager-secret-fill-save');

        cancelButton?.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        saveButton?.addEventListener('click', () => {
            const inputs = Array.from(panel.querySelectorAll('input[data-secret-id]'));
            const emptyIds = [];

            for (const input of inputs) {
                const secretId = String(input.getAttribute('data-secret-id') || '').trim();
                const value = String(input.value || '').trim();

                if (!secretId || !value) {
                    if (secretId) {
                        emptyIds.push(secretId);
                    }
                    continue;
                }

                localStorage.setItem(`faxrd9_key_${secretId}`, value);
            }

            if (emptyIds.length > 0) {
                toast('warning', `还有 ${emptyIds.length} 项密钥未填写，无法导出`);
                return;
            }

            cleanup();
            resolve(true);
        });
    });
}

const SECRET_REFERENCE_PREFIX = '__API_MANAGER_SECRET_REF__:';

function buildSecretReferencePlaceholder({
    key = 'api_key_custom',
    secretId = '',
    source = 'settings.api_key_custom',
} = {}) {
    const payload = {
        schema: 'api-manager-secret-reference',
        version: 1,
        key: String(key || 'api_key_custom'),
        secret_id: String(secretId || ''),
        manual_input_required: true,
        source: String(source || 'settings.api_key_custom'),
    };

    return `${SECRET_REFERENCE_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

function parseSecretReferencePlaceholder(value) {
    const text = String(value || '').trim();
    if (!text.startsWith(SECRET_REFERENCE_PREFIX)) {
        return null;
    }

    try {
        const encoded = text.slice(SECRET_REFERENCE_PREFIX.length);
        const json = decodeURIComponent(encoded);
        const parsed = JSON.parse(json);

        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        if (parsed.schema !== 'api-manager-secret-reference') {
            return null;
        }

        return {
            key: String(parsed.key || 'api_key_custom'),
            secret_id: String(parsed.secret_id || ''),
            manual_input_required: Boolean(parsed.manual_input_required),
            source: String(parsed.source || 'settings.api_key_custom'),
        };
    } catch (error) {
        return null;
    }
}

function getRequestHeadersSafe() {
    const getRequestHeaders = globalAny.getRequestHeaders || globalThis.getRequestHeaders;

    if (typeof getRequestHeaders === 'function') {
        try {
            const headers = getRequestHeaders();
            if (headers && typeof headers === 'object') {
                return headers;
            }
        } catch (error) {
            // 忽略并使用兜底头
        }
    }

    return {
        'Content-Type': 'application/json',
    };
}

async function findSecretValueByApi(key, id = '') {
    const secretKey = String(key || '').trim();
    if (!secretKey) {
        return '';
    }

    const payload = { key: secretKey };
    const secretId = String(id || '').trim();

    if (secretId) {
        payload.id = secretId;
    }

    try {
        const response = await fetch('/api/secrets/find', {
            method: 'POST',
            headers: getRequestHeadersSafe(),
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            return '';
        }

        const data = await response.json();
        return typeof data?.value === 'string'
            ? String(data.value).trim()
            : '';
    } catch (error) {
        return '';
    }
}

async function getSecretValue(id) {
    const rawId = String(id ?? '').trim();
    if (!rawId) {
        return '';
    }

    const runtimeKey = resolveTypeKeyFromRuntime('custom');
    if (runtimeKey && runtimeKey !== rawId && !isLikelySecretId(runtimeKey)) {
        return runtimeKey;
    }

    try {
        const secretsStore = getSecretsStore();
        if (secretsStore && typeof secretsStore === 'object') {
            const byId = secretsStore[rawId];
            if (typeof byId === 'string' && byId.trim()) {
                return byId.trim();
            }

            const byCustomField = secretsStore.api_key_custom;
            if (typeof byCustomField === 'string' && byCustomField.trim()) {
                return byCustomField.trim();
            }
        }
    } catch (error) {
        logError('读取 secrets 失败，回退原始 ID', error);
    }

    const fromSecretId = await findSecretValueByApi('api_key_custom', rawId);
    if (fromSecretId && fromSecretId !== rawId) {
        return fromSecretId;
    }

    if (isLikelySecretId(rawId)) {
        const fromActive = await findSecretValueByApi('api_key_custom');
        if (fromActive && fromActive !== rawId) {
            return fromActive;
        }
    }

    return rawId;
}

function isLikelySecretId(value) {
    const text = String(value || '').trim();
    if (!text) return false;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
    const isSecretToken = /^secret[-_:]/i.test(text) || /secret[-_]?id/i.test(text);
    const isNumericIndex = /^\d+$/.test(text);

    return isUuid || isSecretToken || isNumericIndex;
}

function resolvePlainTextCustomKey(rawValue = '') {
    const rawText = String(rawValue || '').trim();
    const secretsStore = getSecretsStore();
    const byTypeKeyRaw = resolveTypeKeyFromRuntime('custom');
    const byTypeKey = isLikelySecretId(byTypeKeyRaw)
        ? ''
        : String(byTypeKeyRaw || '').trim();

    const byFieldName = typeof secretsStore?.api_key_custom === 'string'
        ? String(secretsStore.api_key_custom).trim()
        : '';

    const bySecretId = rawText && typeof secretsStore?.[rawText] === 'string'
        ? String(secretsStore[rawText]).trim()
        : '';

    return byFieldName || bySecretId || byTypeKey || rawText;
}

async function replaceSecretManagedCustomKeyInExportPayload(apiPresets) {
    let replacedCount = 0;
    const pendingTargets = [];

    const walk = (node, presetName = '未命名配置') => {
        if (!node || typeof node !== 'object') {
            return;
        }

        if (Array.isArray(node)) {
            node.forEach((item, index) => {
                walk(item, `${presetName}#${index + 1}`);
            });
            return;
        }

        const nodeName = getPresetDisplayName(node, presetName);

        for (const [field, value] of Object.entries(node)) {
            if (typeof value === 'string' && isSecretIdField(field) && shouldTreatAsSecretId(field, value)) {
                const secretId = String(value || '').trim();
                if (secretId) {
                    pendingTargets.push({
                        host: node,
                        field,
                        secretId,
                        presetName: nodeName,
                    });
                }
            }

            if (value && typeof value === 'object') {
                walk(value, nodeName);
            }
        }
    };

    walk(apiPresets, '配置');

    const uniqueSecretIds = Array.from(new Set(pendingTargets.map((item) => item.secretId)));
    const resolvedMap = new Map();

    await Promise.all(uniqueSecretIds.map(async (secretId) => {
        let plainText = String(await getRealSecret(secretId) || '').trim();

        if (!plainText) {
            const fallback = String(await getSecretValue(secretId) || '').trim();
            if (fallback && fallback !== secretId && !isLikelySecretId(fallback)) {
                plainText = fallback;
            }
        }

        resolvedMap.set(secretId, plainText || null);
    }));

    const missingRefs = [];
    let lastPlainTextKey = '';

    pendingTargets.forEach((target) => {
        const plainText = String(resolvedMap.get(target.secretId) || '').trim();
        if (plainText) {
            target.host[target.field] = plainText;
            replacedCount += 1;
            lastPlainTextKey = plainText;
        } else {
            missingRefs.push({
                secretId: target.secretId,
                field: target.field,
                presetName: target.presetName,
            });
        }
    });

    return {
        replacedCount,
        lastPlainTextKey,
        missingRefs,
    };
}

function getSecretReferenceIdentity(reference) {
    const key = String(reference?.key || 'api_key_custom').trim();
    const secretId = String(reference?.secret_id || '').trim();
    return `${key}::${secretId}`;
}

function collectSecretReferenceNodes(node, bucket = []) {
    if (!node || typeof node !== 'object') {
        return bucket;
    }

    if (Array.isArray(node)) {
        node.forEach((item) => collectSecretReferenceNodes(item, bucket));
        return bucket;
    }

    for (const [field, value] of Object.entries(node)) {
        if (typeof value === 'string') {
            const reference = parseSecretReferencePlaceholder(value);
            if (reference && reference.manual_input_required) {
                bucket.push({
                    host: node,
                    field,
                    reference,
                });
            }
        }

        if (value && typeof value === 'object') {
            collectSecretReferenceNodes(value, bucket);
        }
    }

    return bucket;
}

function requestManualSecretInput(reference, index, total) {
    const keyName = String(reference?.key || 'api_key_custom');
    const secretId = String(reference?.secret_id || 'unknown');
    const message = [
        `导入检测到受保护密钥占位符（${index}/${total}）`,
        `字段：${keyName}`,
        `Secret ID：${secretId}`,
        '请输入对应明文密钥（留空或取消=跳过，稍后手动填写）',
    ].join('\n');

    const input = window.prompt(message, '');
    if (input === null) {
        return '';
    }

    return String(input || '').trim();
}

async function resolveSecretReferencesInImportedEntries(entries = []) {
    const placeholders = [];

    entries.forEach((entry) => {
        if (entry?.raw && typeof entry.raw === 'object') {
            collectSecretReferenceNodes(entry.raw, placeholders);
        }
    });

    if (!placeholders.length) {
        return {
            total: 0,
            resolved: 0,
            skipped: 0,
            unresolvedRefs: [],
        };
    }

    const answerByIdentity = new Map();
    const uniqueRefs = [];
    const seen = new Set();

    placeholders.forEach((item) => {
        const identity = getSecretReferenceIdentity(item.reference);
        if (!seen.has(identity)) {
            seen.add(identity);
            uniqueRefs.push(item.reference);
        }
    });

    uniqueRefs.forEach((reference, index) => {
        const identity = getSecretReferenceIdentity(reference);
        const answer = requestManualSecretInput(reference, index + 1, uniqueRefs.length);
        answerByIdentity.set(identity, answer);
    });

    let resolved = 0;
    const unresolvedMap = new Map();

    placeholders.forEach((item) => {
        const identity = getSecretReferenceIdentity(item.reference);
        const answer = String(answerByIdentity.get(identity) || '').trim();

        if (answer) {
            item.host[item.field] = answer;
            resolved += 1;
        } else {
            item.host[item.field] = '';
            if (!unresolvedMap.has(identity)) {
                unresolvedMap.set(identity, item.reference);
            }
        }
    });

    return {
        total: placeholders.length,
        resolved,
        skipped: placeholders.length - resolved,
        unresolvedRefs: Array.from(unresolvedMap.values()),
    };
}

/**
 * 读取当前 API 配置（优先 settings + getTypeKey，必要时兜底 UI）
 */
export function captureCurrentConfig() {
    const apiType = detectCurrentApiType();
    const meta = getApiMeta(apiType);
    const normalizedType = normalizeApiType(apiType);
    const settingsConfig = resolveConfigFromSettings(normalizedType);

    const fallbackUrl = readFirstValue([...meta.url, ...GENERIC_SELECTORS.url], { nonEmptyOnly: true });
    const fallbackKey = readFirstValue(
        [...meta.key, ...GENERIC_SELECTORS.key].filter((selector) => selector !== '#api_key_custom'),
    );
    const model = readFirstValue([...meta.model, ...GENERIC_SELECTORS.model]);

    const enforceSettingsOnly = normalizedType === 'custom';
    const url = enforceSettingsOnly ? settingsConfig.url : (settingsConfig.url || fallbackUrl);
    const key = enforceSettingsOnly ? settingsConfig.key : (settingsConfig.key || fallbackKey);

    return {
        api_type: apiType,
        url,
        key,
        model,
    };
}

/**
 * 导出配置 JSON
 */
export async function exportProfiles() {
    if (state.ioBusy) {
        toast('warning', '正在处理导入/导出任务，请稍候...');
        return;
    }

    try {
        const descriptor = getPresetDescriptor();
        if (!descriptor) {
            throw new Error('未找到可导出的 API 配置存储');
        }

        const originalData = descriptor.rawValue;
        // 严禁修改原数据
        let exportCopy = JSON.parse(JSON.stringify(originalData));
        let {
            replacedCount,
            lastPlainTextKey,
            missingRefs,
        } = await replaceSecretManagedCustomKeyInExportPayload(exportCopy);

        // 导出前必须补全密钥；若缺失则先弹窗填写并缓存，再重新执行导出准备。
        if (missingRefs.length > 0) {
            const continued = await requestManualSecretsBeforeExport(missingRefs);
            if (!continued) {
                setPresetStatus('已取消导出：仍有密钥未补全', 'warning');
                toast('warning', '已取消导出：请补全密钥后重试');
                return;
            }

            // 保存后重新走一轮，确保本次导出文件已替换为明文。
            exportCopy = JSON.parse(JSON.stringify(originalData));
            ({
                replacedCount,
                lastPlainTextKey,
                missingRefs,
            } = await replaceSecretManagedCustomKeyInExportPayload(exportCopy));

            if (missingRefs.length > 0) {
                throw new Error('仍有密钥无法解析，请确认已填写完整后重试');
            }
        }

        console.log(LOG_PREFIX, '导出前明文提取结果:', lastPlainTextKey || '(未命中 secret-id 或明文为空)');

        if (replacedCount > 0) {
            log(`导出前已将 ${replacedCount} 处 secret-id 替换为明文 key`);
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
            api_presets: exportCopy,
        };

        const { cancelled, password } = requestOptionalExportPassword();
        if (cancelled) {
            setPresetStatus('已取消导出', 'warning');
            toast('warning', '已取消导出');
            return;
        }

        const useEncryption = Boolean(password);
        if (useEncryption && !hasWebCryptoSupport()) {
            throw new Error('当前环境不支持 Web Crypto API，无法执行密码加密导出');
        }

        setIoBusy(true, useEncryption ? '正在加密导出，请稍候...' : '正在导出配置，请稍候...');

        const finalPayload = useEncryption
            ? await encryptPayloadWithPassword(payload, password)
            : payload;

        const filename = useEncryption
            ? `api-presets-encrypted-${Date.now()}.json`
            : `api-presets-${Date.now()}.json`;

        downloadJson(filename, finalPayload);
        setPresetStatus(useEncryption ? '加密导出成功' : '导出成功', 'success');
        toast('success', useEncryption ? `配置已加密导出成功（替换 ${replacedCount} 项密钥）` : `配置导出成功（替换 ${replacedCount} 项密钥）`);
    } catch (error) {
        logError('导出配置失败', error);
        const message = error?.message || error;
        setPresetStatus(`导出失败：${message}`, 'error');
        toast('error', `导出失败：${message}`);
    } finally {
        setIoBusy(false);
    }
}

export async function exportData() {
    await exportProfiles();
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
    toolbarId: 'api-manager-injected-toolbar',
    searchId: 'api-manager-preset-search',
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
const PRESET_SEARCH_MAX_RESULTS = 8;
const IO_CONTROL_SELECTORS = [
    '#api-manager-panel-export-btn',
    '#api-manager-import-merge-btn',
    '#api-manager-import-replace-btn',
    `#${PRESET_DOM.importButtonId}`,
    `#${PRESET_DOM.exportButtonId}`,
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
    toolbar.className = 'api-manager-injected-toolbar';
    toolbar.innerHTML = `
        <div class="api-manager-search-row">
            <input id="${PRESET_DOM.searchId}" type="search" placeholder="搜索配置..." />
            <button type="button" id="${PRESET_DOM.searchClearId}" class="api-manager-search-clear-btn" aria-label="清空搜索" title="清空搜索">×</button>
            <div id="${PRESET_DOM.searchResultsId}" class="api-manager-search-results" hidden></div>
        </div>
        <div class="api-manager-toolbar-row">
            <button type="button" id="${PRESET_DOM.importButtonId}" class="menu_button">导入</button>
            <button type="button" id="${PRESET_DOM.exportButtonId}" class="menu_button">导出</button>
        </div>
        <input id="${PRESET_DOM.fileInputId}" type="file" accept=".json,application/json" hidden>
        <div id="${PRESET_DOM.statusId}" class="api-manager-status"></div>
    `;
    return toolbar;
}

function setPresetStatus(message, tone = 'info') {
    const status = document.getElementById(PRESET_DOM.statusId);
    if (!status) {
        return;
    }

    status.textContent = String(message || '');
    status.dataset.state = tone;
}

function syncIoBusyControls() {
    const busy = Boolean(state.ioBusy);

    IO_CONTROL_SELECTORS.forEach((selector) => {
        document.querySelectorAll(selector).forEach((node) => {
            const control = /** @type {any} */ (node);
            if (typeof control.disabled === 'boolean') {
                control.disabled = busy;
            }
            node.setAttribute('aria-busy', busy ? 'true' : 'false');
        });
    });
}

function setIoBusy(nextBusy, message = '') {
    state.ioBusy = Boolean(nextBusy);
    syncIoBusyControls();

    if (message) {
        setPresetStatus(message, 'info');
    }
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

    const allOptions = Array.from(select.options)
        .filter((option) => !option.disabled && String(option.value || '').trim() !== '');
    const shownCount = visibleCount ?? allOptions.length;
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
        !option.disabled
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
    const allEntries = Array.from(select.options)
        .map((option, optionIndex) => ({
            option,
            optionIndex,
            label: String(option.textContent || option.value || '').trim() || `配置 ${optionIndex + 1}`,
            value: String(option.value || ''),
        }))
        .filter((entry) => !entry.option.disabled && entry.value.trim() !== '');

    const matchedEntries = normalizedKeyword
        ? allEntries.filter((entry) => `${entry.label.toLowerCase()} ${entry.value.toLowerCase()}`.includes(normalizedKeyword))
        : allEntries;

    const totalCount = allEntries.length;
    const visibleCount = matchedEntries.length;

    if (normalizedKeyword && matchedEntries.length) {
        const selectedValue = String(select.value || '');
        const hasMatchedSelection = matchedEntries.some((entry) => entry.value === selectedValue);

        if (!hasMatchedSelection) {
            select.value = matchedEntries[0].value;
        }
    }

    syncPresetSelectPresentation(select);
    renderPresetSearchResults(
        toolbar,
        normalizedKeyword,
        matchedEntries.map((entry) => ({
            optionIndex: entry.optionIndex,
            label: entry.label,
        })),
    );

    updatePresetSelectStatus(select, normalizedKeyword ? visibleCount : totalCount, totalCount);

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

    if (!(panel instanceof HTMLElement) || !(select instanceof HTMLSelectElement)) {
        return false;
    }

    // 清理旧版本遗留工具栏，避免移动端出现重复节点导致的错位。
    document.querySelectorAll('#api-manager-toolbar, .api-manager-injected-toolbar').forEach((node) => {
        if (node.id !== PRESET_DOM.toolbarId) {
            node.remove();
        }
    });

    let toolbar = document.getElementById(PRESET_DOM.toolbarId);
    if (toolbar && toolbar.parentElement !== panel) {
        toolbar.remove();
        toolbar = null;
    }

    if (!toolbar) {
        toolbar = createPresetToolbar();
        panel.insertBefore(toolbar, panel.firstChild || null);
    }

    bindPresetToolbarEvents(toolbar);

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

    if (state.ioBusy) {
        toast('warning', '正在处理导入/导出任务，请稍候...');
        return;
    }

    try {
        if (!window.confirm('导入前建议先导出当前配置作为备份，是否继续导入？')) {
            setPresetStatus('已取消导入', 'warning');
            return;
        }

        const descriptor = getPresetDescriptor();
        if (!descriptor) {
            throw new Error('未找到可写入的 API 配置存储');
        }

        setIoBusy(true, '正在读取导入文件，请稍候...');

        const text = await file.text();
        let parsed = JSON.parse(text);

        if (isEncryptedExportPayload(parsed)) {
            const password = requestImportPassword();
            if (!password) {
                setPresetStatus('已取消导入', 'warning');
                toast('warning', '未输入访问密码，已取消导入');
                return;
            }

            setPresetStatus('正在解密导入文件，请稍候...', 'info');
            try {
                parsed = await decryptPayloadWithPassword(parsed, password);
            } catch (decryptError) {
                throw new Error('密码错误或文件损坏');
            }
        }

        setPresetStatus('正在校验并导入配置，请稍候...', 'info');
        const imported = normalizeImportedPresetPayload(parsed);
        const secretResolution = await resolveSecretReferencesInImportedEntries(imported.entries);
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
        if (secretResolution.skipped > 0) {
            const pendingSummary = secretResolution.unresolvedRefs
                .map((item) => `${item.key}${item.secret_id ? `(${item.secret_id.slice(0, 8)}...)` : ''}`)
                .slice(0, 3)
                .join('、');
            const pendingText = pendingSummary ? `，待补：${pendingSummary}` : '';

            setPresetStatus(`${modeText}导入 ${importedCount} 条配置，${secretResolution.skipped} 项密钥待手动补填`, 'warning');
            toast('warning', `导入完成（${modeText}）：${importedCount} 条配置，${secretResolution.skipped} 项密钥待补填${pendingText}`);
        } else {
            setPresetStatus(`${modeText}导入 ${importedCount} 条配置`, 'success');
            toast('success', `导入完成（${modeText}）：${importedCount} 条配置`);
        }
    } catch (error) {
        logError('导入配置失败', error);
        const message = error?.message || error;
        toast('error', `导入失败：${message}`);
        setPresetStatus(`导入失败：${message}`, 'error');
    } finally {
        setIoBusy(false);
    }
}

function openPanel() {
    ensureManagerPanel();
    $(UI.overlay).addClass('is-open').attr('aria-hidden', 'false').show();
    state.panelOpen = true;
    renderProfileList();
}

function closePanel() {
    $(UI.overlay).removeClass('is-open').attr('aria-hidden', 'true').hide();
    state.panelOpen = false;
}

function openImportDialog(mode) {
    if (state.ioBusy) {
        toast('warning', '正在处理导入/导出任务，请稍候...');
        return;
    }

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
    $(document).on(`pointerdown${EVENT_NS}`, UI.overlay, (event) => {
        if (event.target === event.currentTarget || $(event.target).closest(UI.panel).length === 0) {
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

    $(document).on(`click${EVENT_NS}`, '#api-manager-panel-export-btn', () => {
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
        <div id="api-manager-overlay" class="api-manager-overlay" aria-hidden="true">
            <div id="api-manager-panel" class="api-manager-panel" role="dialog" aria-modal="true" aria-label="API 配置管理">
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
                    <button type="button" id="api-manager-panel-export-btn" class="menu_button">导出</button>
                    <button type="button" id="api-manager-import-merge-btn" class="menu_button">导入(合并)</button>
                    <button type="button" id="api-manager-import-replace-btn" class="menu_button">导入(替换)</button>
                    <input id="api-manager-import-input" type="file" accept=".json,application/json" hidden>
                </div>
            </div>
        </div>
    `;
}

function ensureManagerPanel() {
    if (!document.body) {
        return false;
    }

    const hasOverlay = $(UI.overlay).length > 0;
    const hasPanel = $(UI.panel).length > 0;
    if (hasOverlay && hasPanel) {
        return true;
    }

    $(UI.overlay).remove();
    $('body').append(buildPanelHtml());
    return true;
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

    // 右侧避让统一交由 CSS（含 safe-area），避免 JS 注入固定像素值。
    $float.css('right', '');

    // 始终保留悬浮入口，避免标题栏按钮被滚动出视口后“找不到入口”。
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
    const panelReady = ensureManagerPanel();
    ensureFloatingTrigger();
    bindEvents();
    syncFloatingTriggerState();

    const injected = ensurePresetToolbar();

    if (injected) {
        const { selector } = resolvePresetPanelHost();
        log('已注入 API 搜索/导入导出工具栏，宿主：', selector || '(unknown)');
    }

    return panelReady || injected;
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