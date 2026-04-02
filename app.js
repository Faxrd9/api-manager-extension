import { event_types, eventSource, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { Popup, POPUP_RESULT } from '../../../popup.js';
import { findSecret, SECRET_KEYS, writeSecret } from '../../../secrets.js';

const LOG_PREFIX = '[API Search]';
const EXPORT_FORMAT = 'api-manager-openai-compatible-v1';
const EXPORT_ENCRYPTION_VERSION = 'aes-gcm-v1';
const PBKDF2_ITERATIONS = 120000;
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
    actionsId: 'api-search-actions',
    exportId: 'api-search-export-btn',
    importId: 'api-search-import-btn',
    importFileId: 'api-search-import-file',
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

const OPENAI_COMPATIBLE_API = 'custom';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function getConnectionManagerState() {
    extension_settings.connectionManager = extension_settings.connectionManager || {};

    if (!Array.isArray(extension_settings.connectionManager.profiles)) {
        extension_settings.connectionManager.profiles = [];
    }

    if (typeof extension_settings.connectionManager.selectedProfile !== 'string') {
        extension_settings.connectionManager.selectedProfile = '';
    }

    return extension_settings.connectionManager;
}

function getOpenAiCompatibleProfiles() {
    const manager = getConnectionManagerState();
    return manager.profiles.filter((profile) => {
        if (!profile || typeof profile !== 'object') {
            return false;
        }

        return String(profile.mode || '').toLowerCase() === 'cc'
            && String(profile.api || '').toLowerCase() === OPENAI_COMPATIBLE_API;
    });
}

function createExportFileName() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `api-manager-openai-configs-${yyyy}${mm}${dd}-${hh}${mi}${ss}.json`;
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function randomBytes(length) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
}

async function deriveAesKeyFromPassword(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw',
        textEncoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey'],
    );

    return globalThis.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256',
        },
        keyMaterial,
        {
            name: 'AES-GCM',
            length: 256,
        },
        false,
        ['encrypt', 'decrypt'],
    );
}

async function encryptTextWithAesKey(plainText, aesKey) {
    const iv = randomBytes(12);
    const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        textEncoder.encode(String(plainText || '')),
    );

    return {
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(encrypted)),
    };
}

async function decryptTextWithAesKey(payload, aesKey) {
    const iv = base64ToBytes(payload?.iv);
    const data = base64ToBytes(payload?.data);

    const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        data,
    );

    return textDecoder.decode(decrypted);
}

function downloadJson(payload, fileName) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1200);
}

async function askExportPassword() {
    const password = await Popup.show.input(
        '导出加密设置',
        '可选：输入密码以加密导出 API Key。\n留空将以明文导出 API Key（有泄露风险）。',
        '',
        {
            rows: 1,
            okButton: '继续导出',
            cancelButton: '取消',
        },
    );

    if (password === null) {
        return null;
    }

    return String(password || '');
}

async function exportOpenAiConfigs() {
    const profiles = getOpenAiCompatibleProfiles();
    const exportPassword = await askExportPassword();

    if (exportPassword === null) {
        return;
    }

    const hasPassword = Boolean(exportPassword);
    let unresolvedSecrets = 0;

    const items = [];

    let keyDerivationSalt = null;
    let derivedKey = null;

    if (hasPassword) {
        keyDerivationSalt = randomBytes(16);
        derivedKey = await deriveAesKeyFromPassword(exportPassword, keyDerivationSalt, PBKDF2_ITERATIONS);
    }

    for (const profile of profiles) {
        const url = String(profile['api-url'] || '').trim();
        const secretId = String(profile['secret-id'] || '').trim();

        let apiKey = '';
        if (secretId) {
            const value = await findSecret(SECRET_KEYS.CUSTOM, secretId);
            if (value === null) {
                unresolvedSecrets += 1;
            } else {
                apiKey = String(value || '');
            }
        }

        if (!url && !apiKey) {
            continue;
        }

        const item = {
            name: String(profile.name || '').trim(),
            url,
        };

        if (hasPassword && apiKey) {
            const encrypted = await encryptTextWithAesKey(apiKey, derivedKey);
            item.apikeyEncrypted = encrypted;
        } else if (!hasPassword) {
            item.apikey = apiKey;
        }

        items.push(item);
    }

    if (!items.length) {
        toastr.info('没有可导出的 OpenAI 兼容配置');
        return;
    }

    const payload = {
        format: EXPORT_FORMAT,
        type: 'openai-compatible',
        exportedAt: new Date().toISOString(),
        items,
    };

    if (hasPassword && keyDerivationSalt) {
        payload.encryption = {
            scheme: EXPORT_ENCRYPTION_VERSION,
            kdf: 'PBKDF2-SHA256',
            iterations: PBKDF2_ITERATIONS,
            salt: bytesToBase64(keyDerivationSalt),
        };
    }

    downloadJson(payload, createExportFileName());

    if (hasPassword) {
        if (unresolvedSecrets > 0) {
            toastr.warning(`已加密导出 ${items.length} 条配置，${unresolvedSecrets} 条 API Key 无法读取`);
        } else {
            toastr.success(`已加密导出 ${items.length} 条 OpenAI 兼容配置`);
        }
        return;
    }

    if (unresolvedSecrets > 0) {
        toastr.warning(`已明文导出 ${items.length} 条配置，${unresolvedSecrets} 条 API Key 无法读取`);
    } else {
        toastr.success(`已明文导出 ${items.length} 条 OpenAI 兼容配置`);
    }
}

function parseImportPayload(rawText) {
    const parsed = JSON.parse(rawText);

    if (!parsed || typeof parsed !== 'object' || parsed.format !== EXPORT_FORMAT || !Array.isArray(parsed.items)) {
        throw new Error('文件格式不匹配');
    }

    const encryption = parsed.encryption && typeof parsed.encryption === 'object'
        ? parsed.encryption
        : null;

    const hasEncrypted = parsed.items.some((entry) => Boolean(entry?.apikeyEncrypted));

    const items = parsed.items
        .map((entry) => ({
            name: String(entry?.name || '').trim(),
            url: String(entry?.url || '').trim(),
            apikey: String(entry?.apikey || '').trim(),
            apikeyEncrypted: entry?.apikeyEncrypted || null,
        }))
        .filter((entry) => entry.url || entry.apikey || entry.apikeyEncrypted || entry.name);

    if (!items.length) {
        throw new Error('文件中没有可导入的配置');
    }

    return {
        items,
        encryption,
        hasEncrypted,
    };
}

function createProfileId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    return `api-manager-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function guessProfileName(url, index) {
    if (url) {
        try {
            const host = new URL(url).host;
            if (host) {
                return `OpenAI Compatible - ${host}`;
            }
        } catch {
            // ignore invalid url and fallback below
        }
    }

    return `OpenAI Compatible - Imported ${index + 1}`;
}

function ensureUniqueProfileName(baseName, existingNames) {
    const root = String(baseName || 'OpenAI Compatible - Imported').trim() || 'OpenAI Compatible - Imported';

    if (!existingNames.has(root)) {
        return root;
    }

    let index = 2;
    let candidate = `${root} (${index})`;
    while (existingNames.has(candidate)) {
        index += 1;
        candidate = `${root} (${index})`;
    }

    return candidate;
}

function refreshConnectionProfilesSelect() {
    const select = document.querySelector('#connection_profiles');
    if (!(select instanceof HTMLSelectElement)) {
        return;
    }

    const manager = getConnectionManagerState();
    const selectedProfile = manager.selectedProfile;

    select.innerHTML = '';

    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = '<None>';
    noneOption.selected = !selectedProfile;
    select.appendChild(noneOption);

    const sortedProfiles = [...manager.profiles].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));

    sortedProfiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = String(profile?.id || '');
        option.textContent = String(profile?.name || profile?.id || 'Unnamed Profile');
        option.selected = option.value === selectedProfile;
        select.appendChild(option);
    });
}

async function askImportConfirmation(totalCount, encryptedCount, plainKeyCount) {
    const lines = [
        `检测到 ${totalCount} 条可导入配置。`,
        encryptedCount > 0 ? `其中 ${encryptedCount} 条包含加密 API Key。` : '未检测到加密 API Key。',
        plainKeyCount > 0 ? `其中 ${plainKeyCount} 条包含明文 API Key。` : '未检测到明文 API Key。',
        '是否继续导入？',
    ];

    const result = await Popup.show.confirm('确认导入', lines.join('\n'), {
        okButton: '继续导入',
        cancelButton: '取消',
    });

    return result === POPUP_RESULT.AFFIRMATIVE;
}

async function resolveImportApiKey(item, encryption, cachedPasswordState) {
    if (item.apikey) {
        return item.apikey;
    }

    if (!item.apikeyEncrypted) {
        return '';
    }

    if (!encryption || encryption.scheme !== EXPORT_ENCRYPTION_VERSION || !encryption.salt) {
        throw new Error('加密配置缺少必要参数，无法解密');
    }

    if (cachedPasswordState.cancelled) {
        throw new Error('用户取消了解密');
    }

    if (!cachedPasswordState.key) {
        const password = await Popup.show.input(
            '导入解密密码',
            '该文件包含加密 API Key，请输入导出时设置的密码。',
            '',
            {
                rows: 1,
                okButton: '解密并导入',
                cancelButton: '取消',
            },
        );

        if (password === null) {
            cachedPasswordState.cancelled = true;
            throw new Error('用户取消了解密');
        }

        const salt = base64ToBytes(encryption.salt);
        const iterations = Number(encryption.iterations) || PBKDF2_ITERATIONS;
        cachedPasswordState.key = await deriveAesKeyFromPassword(String(password || ''), salt, iterations);
    }

    try {
        return await decryptTextWithAesKey(item.apikeyEncrypted, cachedPasswordState.key);
    } catch {
        throw new Error('解密失败：密码错误或文件已损坏');
    }
}

function createConfigFingerprint(url, apiKey) {
    const normalizedUrl = String(url || '').trim();
    const normalizedKey = String(apiKey || '').trim();
    return `${normalizedUrl}\n${normalizedKey}`;
}

async function collectExistingConfigFingerprints() {
    const fingerprints = new Set();
    let unreadableSecretCount = 0;

    const profiles = getOpenAiCompatibleProfiles();

    for (const profile of profiles) {
        const url = String(profile?.['api-url'] || '').trim();
        const secretId = String(profile?.['secret-id'] || '').trim();

        let apiKey = '';
        if (secretId) {
            const resolved = await findSecret(SECRET_KEYS.CUSTOM, secretId);
            if (resolved === null) {
                unreadableSecretCount += 1;
            } else {
                apiKey = String(resolved || '');
            }
        }

        if (!url && !apiKey) {
            continue;
        }

        fingerprints.add(createConfigFingerprint(url, apiKey));
    }

    return {
        fingerprints,
        unreadableSecretCount,
    };
}

async function importOpenAiConfigsFromFile(file) {
    if (!(file instanceof File)) {
        return;
    }

    const rawText = await file.text();
    const parsedImport = parseImportPayload(rawText);
    const importedItems = parsedImport.items;

    const encryptedCount = importedItems.filter((item) => Boolean(item.apikeyEncrypted)).length;
    const plainKeyCount = importedItems.filter((item) => Boolean(item.apikey)).length;

    const confirmed = await askImportConfirmation(importedItems.length, encryptedCount, plainKeyCount);
    if (!confirmed) {
        return;
    }

    const manager = getConnectionManagerState();
    const existingNames = new Set(manager.profiles.map((profile) => String(profile?.name || '').trim()));

    const existingConfigs = await collectExistingConfigFingerprints();
    const knownFingerprints = existingConfigs.fingerprints;

    let importedCount = 0;
    let skippedDuplicateCount = 0;
    const passwordState = {
        key: null,
        cancelled: false,
    };

    for (let i = 0; i < importedItems.length; i += 1) {
        const item = importedItems[i];
        const resolvedApiKey = await resolveImportApiKey(item, parsedImport.encryption, passwordState);
        const fingerprint = createConfigFingerprint(item.url, resolvedApiKey);

        if (knownFingerprints.has(fingerprint)) {
            skippedDuplicateCount += 1;
            continue;
        }

        const preferredName = String(item.name || '').trim() || guessProfileName(item.url, i);
        const name = ensureUniqueProfileName(preferredName, existingNames);
        existingNames.add(name);

        let secretId = '';
        if (resolvedApiKey) {
            const keyLabel = `${name} (${new Date().toLocaleString()})`;
            secretId = String(await writeSecret(SECRET_KEYS.CUSTOM, resolvedApiKey, keyLabel) || '');
        }

        const profile = {
            id: createProfileId(),
            mode: 'cc',
            api: OPENAI_COMPATIBLE_API,
            name,
            exclude: [],
        };

        if (item.url) {
            profile['api-url'] = item.url;
        }

        if (secretId) {
            profile['secret-id'] = secretId;
        }

        manager.profiles.push(profile);
        importedCount += 1;
        knownFingerprints.add(fingerprint);

        await eventSource.emit(event_types.CONNECTION_PROFILE_CREATED, profile);
    }

    if (!importedCount) {
        if (skippedDuplicateCount > 0) {
            toastr.info(`未导入新配置：${skippedDuplicateCount} 条重复配置已跳过`);
            return;
        }

        toastr.warning('没有导入任何配置');
        return;
    }

    saveSettingsDebounced();
    refreshConnectionProfilesSelect();
    scheduleReinject();

    if (existingConfigs.unreadableSecretCount > 0) {
        toastr.warning(`已导入 ${importedCount} 条，跳过 ${skippedDuplicateCount} 条重复。另有 ${existingConfigs.unreadableSecretCount} 条本地密钥不可读，去重可能不完整`);
        return;
    }

    toastr.success(`已导入 ${importedCount} 条 OpenAI 兼容配置，跳过 ${skippedDuplicateCount} 条重复`);
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
        <div id="${PRESET_DOM.actionsId}" class="api-manager-actions-row">
            <button type="button" id="${PRESET_DOM.exportId}" class="menu_button" title="导出 OpenAI 兼容配置">导出</button>
            <button type="button" id="${PRESET_DOM.importId}" class="menu_button" title="导入 OpenAI 兼容配置">导入</button>
            <input id="${PRESET_DOM.importFileId}" type="file" accept="application/json,.json" hidden />
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
    const exportButton = toolbar.querySelector(`#${PRESET_DOM.exportId}`);
    const importButton = toolbar.querySelector(`#${PRESET_DOM.importId}`);
    const importFileInput = toolbar.querySelector(`#${PRESET_DOM.importFileId}`);
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

    if (exportButton instanceof HTMLButtonElement && !exportButton.dataset.bound) {
        exportButton.dataset.bound = '1';
        exportButton.addEventListener('click', async () => {
            try {
                await exportOpenAiConfigs();
            } catch (error) {
                console.error(LOG_PREFIX, '导出配置失败', error);
                toastr.error('导出失败，请查看控制台日志');
            }
        });
    }

    if (importButton instanceof HTMLButtonElement && importFileInput instanceof HTMLInputElement && !importButton.dataset.bound) {
        importButton.dataset.bound = '1';

        importButton.addEventListener('click', () => {
            importFileInput.value = '';
            importFileInput.click();
        });

        importFileInput.addEventListener('change', async () => {
            const file = importFileInput.files?.[0];
            if (!file) {
                return;
            }

            try {
                await importOpenAiConfigsFromFile(file);
            } catch (error) {
                console.error(LOG_PREFIX, '导入配置失败', error);
                toastr.error(`导入失败：${error?.message || '文件格式或内容异常'}`);
            } finally {
                importFileInput.value = '';
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
