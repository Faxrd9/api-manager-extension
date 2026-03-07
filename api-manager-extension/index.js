async function bootstrap() {
    try {
        const appModuleUrl = new URL('./app.js', import.meta.url).href;
        const { initApiManagerExtension } = await import(appModuleUrl);
        await initApiManagerExtension();
    } catch (error) {
        console.error('[API管理器] 初始化异常', error);
    }
}

const globalAny = /** @type {any} */ (globalThis);
const jq = globalAny.jQuery || globalAny.$;

if (typeof jq === 'function') {
    jq(() => {
        void bootstrap();
    });
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrap();
    }, { once: true });
} else {
    void bootstrap();
}
