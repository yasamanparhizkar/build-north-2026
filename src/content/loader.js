// Content scripts can't be ES modules via the manifest, so this tiny classic
// script loads the real module (see web_accessible_resources in manifest.json).
import(chrome.runtime.getURL('src/content/main.js'));

