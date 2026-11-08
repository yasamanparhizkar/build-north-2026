// Pure helpers that guess a descriptive name for a control that has no label of its own
// (no DOM access, unit tested). The DOM readers live in accname.js.

/** Words found in icon class names, ids and test hooks -> the label a person would use. */
const ICON_WORDS = {
  search: 'Search', magnify: 'Search', magnifier: 'Search', magnifying: 'Search',
  close: 'Close', xmark: 'Close', times: 'Close', cross: 'Close', dismiss: 'Close',
  menu: 'Menu', hamburger: 'Menu', bars: 'Menu', navicon: 'Menu',
  share: 'Share', cart: 'Cart', basket: 'Cart', bag: 'Cart', shoppingcart: 'Cart',
  home: 'Home', back: 'Back', arrowleft: 'Back', chevronleft: 'Back', previous: 'Previous',
  forward: 'Next', arrowright: 'Next', chevronright: 'Next', next: 'Next',
  settings: 'Settings', gear: 'Settings', cog: 'Settings',
  download: 'Download', print: 'Print', upload: 'Upload', copy: 'Copy',
  more: 'More', ellipsis: 'More', dots: 'More', kebab: 'More', meatball: 'More',
  edit: 'Edit', pencil: 'Edit', pen: 'Edit', delete: 'Delete', trash: 'Delete', bin: 'Delete',
  heart: 'Favorite', like: 'Like', star: 'Star', bell: 'Notifications', notification: 'Notifications',
  user: 'Account', profile: 'Account', account: 'Account', person: 'Account',
  mail: 'Email', envelope: 'Email', email: 'Email', phone: 'Phone',
  play: 'Play', pause: 'Pause', mute: 'Mute', mic: 'Microphone', microphone: 'Microphone',
  camera: 'Camera', video: 'Camera', plus: 'Add', add: 'Add', info: 'Info',
  help: 'Help', question: 'Help', filter: 'Filter', refresh: 'Refresh', reload: 'Refresh',
  chat: 'Chat', message: 'Chat', comment: 'Comment', logout: 'Sign out', signout: 'Sign out'
};

const LINK_PATHS = {
  cart: 'Cart', basket: 'Cart', bag: 'Cart', checkout: 'Checkout',
  login: 'Sign in', signin: 'Sign in', 'sign-in': 'Sign in', logout: 'Sign out', signout: 'Sign out',
  search: 'Search', account: 'Account', profile: 'Account', settings: 'Settings', preferences: 'Settings',
  home: 'Home', help: 'Help', support: 'Help', faq: 'Help', contact: 'Contact',
  wishlist: 'Favorites', favorites: 'Favorites', news: 'News', blog: 'Blog'
};

const LINK_HOSTS = {
  'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
  'linkedin.com': 'LinkedIn', 'twitter.com': 'X', 'x.com': 'X', 'whatsapp.com': 'WhatsApp', 'wa.me': 'WhatsApp'
};

const FIELD_AUTOCOMPLETE = {
  email: 'Email', tel: 'Phone', 'current-password': 'Password', 'new-password': 'Password',
  'given-name': 'First name', 'family-name': 'Last name', name: 'Name', 'postal-code': 'Postal code',
  'street-address': 'Address', 'address-line1': 'Address', 'cc-number': 'Card number', username: 'Username'
};

const FIELD_NAME = {
  q: 'Search', query: 'Search', search: 'Search', keyword: 'Search', keywords: 'Search',
  email: 'Email', password: 'Password', pass: 'Password', phone: 'Phone', tel: 'Phone',
  zip: 'Postal code', postcode: 'Postal code', username: 'Username'
};

/** Short, plain words for each role, used in "unlabeled ..." and "... near ..." names. */
const ROLE_WORDS = {
  button: 'button', link: 'link', textbox: 'text field', searchbox: 'search field', combobox: 'dropdown',
  checkbox: 'checkbox', radio: 'radio button', switch: 'switch', slider: 'slider', spinbutton: 'number field',
  tab: 'tab', menuitem: 'menu item', option: 'option', treeitem: 'item', generic: 'control'
};

export function roleWord(role) {
  return ROLE_WORDS[role] || 'control';
}

/** Icon label from class/id/test-hook tokens. Hashed or unknown tokens are ignored. */
export function iconWord(tokens) {
  const parts = tokens.flatMap((raw) => String(raw || '').toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean);
  const words = new Set(parts.map((t) => ICON_WORDS[t]).filter(Boolean));
  // Lucide's close icon is class="lucide lucide-x": the bare "x" only counts next to "lucide".
  if (parts.includes('lucide') && parts.includes('x')) words.add('Close');
  // Conflicting words (e.g. "search" and "close") mean we cannot tell what the control does.
  return words.size === 1 ? [...words][0] : '';
}

/** Label from a link's destination (relative or absolute). */
export function linkWord(href) {
  const value = String(href || '').trim();
  if (!value) return '';
  if (/^mailto:/i.test(value)) return 'Email';
  if (/^tel:/i.test(value)) return 'Phone';
  let url;
  try {
    url = new URL(value, 'https://page.invalid/');
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'page.invalid' && LINK_HOSTS[host]) return LINK_HOSTS[host];
  const first = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
  return LINK_PATHS[first] || '';
}

/** Label from a form field's autocomplete token or its name attribute. */
export function fieldWord({ autocomplete = '', name = '', type = '' }) {
  const auto = String(autocomplete).trim().toLowerCase().split(/\s+/).pop();
  if (FIELD_AUTOCOMPLETE[auto]) return FIELD_AUTOCOMPLETE[auto];
  if (String(type).toLowerCase() === 'search') return 'Search';
  if (String(type).toLowerCase() === 'password') return 'Password';
  const key = String(name).toLowerCase().replace(/[^a-z]/g, '');
  return FIELD_NAME[key] || '';
}

/** Name used when nothing better is known. Never empty, so no control is dropped. */
export function unlabeledName(role) {
  return `unlabeled ${roleWord(role)}`;
}

/** "button near 'Quarterly report'" for a control whose only clue is nearby text. */
export function nearbyName(role, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  return clean.length >= 2 ? `${roleWord(role)} near "${clean}"` : '';
}

/** Short, non-reversible fingerprint (FNV-1a, hex) used as a cache key for icon appearance. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
