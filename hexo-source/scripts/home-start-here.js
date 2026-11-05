/* global hexo */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Load the project override after Hexo has loaded the installed theme views.
hexo.extend.filter.register('before_generate', () => {
  if (hexo.config.theme !== 'butterfly') return;
  const view = readFileSync(join(hexo.base_dir, 'layouts', 'home-start-here.pug'), 'utf8');
  hexo.theme.setView('index.pug', view);
});
