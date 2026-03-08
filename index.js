const LOG_PREFIX = '[API管理器]';
const LIFECYCLE_KEY = '__api_manager_extension_lifecycle__';
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
    if (lifecycle.bootstrapping || lifecycle.initialized) {
        return lifecycle.status;
    }

    lifecycle.bootstrapping = true;
    lifecycle.status = 'loading';
    lifecycle.error = null;

    try {
        const appModuleUrl = new URL('./app.js', import.meta.url).href;
        const appModule = await import(appModuleUrl);
        const initApiManagerExtension = appModule?.initApiManagerExtension;

        if (typeof initApiManagerExtension !== 'function') {
            throw new Error('入口模块缺少 initApiManagerExtension 导出');
        }

        await initApiManagerExtension();

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

export async function initApiManagerLifecycle() {
    await initializeExtension();
}

export const apiManagerLifecycleState = getLifecycleState();
export default initApiManagerLifecycle;

if (!bootstrapByJqueryHook()) {
    bootstrapFallback();
}
