const LOG_PREFIX = '[API Search]';
const EXT_VERSION = '3.1.0';
const LIFECYCLE_KEY = '__api_search_extension_lifecycle__';
const VERSION_KEY = '__api_search_extension_version__';
const RELOAD_ONCE_KEY = '__api_search_extension_reloaded_once__';
const globalAny = /** @type {any} */ (globalThis);

function getLifecycleState() {
    const current = globalAny[LIFECYCLE_KEY];
    if (current && typeof current === 'object') {
        return current;
    }

    const nextState = {
        status: 'idle',
        bootstrapping: false,
        initialized: false,
        error: null,
    };

    globalAny[LIFECYCLE_KEY] = nextState;
    return nextState;
}

async function initializeExtension() {
    const lifecycle = getLifecycleState();

    if (ensureReloadAfterInstallOrUpdate()) {
        lifecycle.status = 'reloading';
        return lifecycle.status;
    }

    if (lifecycle.bootstrapping || lifecycle.initialized) {
        return lifecycle.status;
    }

    lifecycle.bootstrapping = true;
    lifecycle.status = 'loading';
    lifecycle.error = null;

    try {
        const appModuleUrl = new URL('./app.js', import.meta.url).href;
        const appModule = await import(appModuleUrl);
        const initApiSearchExtension = appModule?.initApiManagerExtension;

        if (typeof initApiSearchExtension !== 'function') {
            throw new Error('入口模块缺少 initApiManagerExtension 导出');
        }

        await initApiSearchExtension();

        lifecycle.initialized = true;
        lifecycle.status = 'loaded';
    } catch (error) {
        lifecycle.status = 'error';
        lifecycle.error = error?.message || String(error);
        console.error(LOG_PREFIX, '初始化异常', error);
        throw error;
    } finally {
        lifecycle.bootstrapping = false;
    }

    return lifecycle.status;
}

function ensureReloadAfterInstallOrUpdate() {
    try {
        const previousVersion = String(localStorage.getItem(VERSION_KEY) || '');
        const reloadedMark = String(sessionStorage.getItem(RELOAD_ONCE_KEY) || '');

        if (previousVersion !== EXT_VERSION) {
            localStorage.setItem(VERSION_KEY, EXT_VERSION);

            if (reloadedMark !== EXT_VERSION) {
                sessionStorage.setItem(RELOAD_ONCE_KEY, EXT_VERSION);
                setTimeout(() => {
                    globalThis.location?.reload?.();
                }, 60);
                return true;
            }
        }

        if (reloadedMark === EXT_VERSION) {
            sessionStorage.removeItem(RELOAD_ONCE_KEY);
        }
    } catch (error) {
        console.warn(LOG_PREFIX, '版本刷新检查失败，继续常规初始化', error);
    }

    return false;
}

function bootstrapByJqueryHook() {
    const jQueryRef = globalAny.jQuery;
    if (typeof jQueryRef === 'function') {
        jQueryRef(async () => {
            try {
                await initializeExtension();
            } catch {
                // 错误已在 initializeExtension 中记录
            }
        });
        return true;
    }

    const dollarRef = globalAny.$;
    if (typeof dollarRef === 'function') {
        dollarRef(async () => {
            try {
                await initializeExtension();
            } catch {
                // 错误已在 initializeExtension 中记录
            }
        });
        return true;
    }

    return false;
}

function bootstrapFallback() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            void initializeExtension().catch(() => {
                // 错误已在 initializeExtension 中记录
            });
        }, { once: true });
        return;
    }

    void initializeExtension().catch(() => {
        // 错误已在 initializeExtension 中记录
    });
}

export async function initApiSearchLifecycle() {
    await initializeExtension();
}

export const apiSearchLifecycleState = getLifecycleState();
export default initApiSearchLifecycle;

if (!bootstrapByJqueryHook()) {
    bootstrapFallback();
}
