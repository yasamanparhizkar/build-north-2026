// Content scripts cannot be ES modules via the manifest, so this tiny classic
// script loads the real module (listed in web_accessible_resources).
// The flag lives in the extension's isolated world, so re-injection is a no-op.
if (window.top === window && !window.__seniorHelperLoaded) {
  window.__seniorHelperLoaded = true;
  import(chrome.runtime.getURL('src/content/main.js')).catch((e) => {
    window.__seniorHelperLoaded = false;
    console.warn('[Senior Helper] failed to load', e);
  });
}
