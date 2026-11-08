import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldWord, iconWord, linkWord, nearbyName, unlabeledName } from '../src/content/nameHints.js';

test('iconWord maps common icon libraries to one plain label', () => {
  assert.equal(iconWord(['fa fa-search']), 'Search');
  assert.equal(iconWord(['bi bi-search']), 'Search');
  assert.equal(iconWord(['lucide lucide-x']), 'Close');
  assert.equal(iconWord(['icon-cart']), 'Cart');
  assert.equal(iconWord(['#icon-menu']), 'Menu');
});

test('iconWord ignores hashed and minified class names', () => {
  assert.equal(iconWord(['css-1x9f2ab']), '');
  assert.equal(iconWord(['_3xK7 btn']), '');
});

test('iconWord gives up when the tokens disagree', () => {
  assert.equal(iconWord(['search close']), '');
});

test('linkWord reads the destination, not the text', () => {
  assert.equal(linkWord('/cart?x=1'), 'Cart');
  assert.equal(linkWord('https://www.facebook.com/somepage'), 'Facebook');
  assert.equal(linkWord('mailto:someone@example.com'), 'Email');
  assert.equal(linkWord('tel:+15551234'), 'Phone');
  assert.equal(linkWord('#top'), '');
  assert.equal(linkWord('/blog/post-1'), 'Blog');
});

test('fieldWord uses autocomplete first, then type and name', () => {
  assert.equal(fieldWord({ autocomplete: 'email' }), 'Email');
  assert.equal(fieldWord({ autocomplete: 'section-x current-password' }), 'Password');
  assert.equal(fieldWord({ type: 'search' }), 'Search');
  assert.equal(fieldWord({ name: 'q' }), 'Search');
  assert.equal(fieldWord({ name: 'middle_name' }), '');
});

test('unlabeledName and nearbyName never return an empty name', () => {
  assert.equal(unlabeledName('textbox'), 'unlabeled text field');
  assert.equal(unlabeledName('something-new'), 'unlabeled control');
  assert.equal(nearbyName('button', '  Quarterly   report  '), 'button near "Quarterly report"');
  assert.equal(nearbyName('button', 'x'), '');
  assert.equal(nearbyName('button', 'a very long heading that goes on and on and on'), 'button near "a very long heading that goes"');
});
