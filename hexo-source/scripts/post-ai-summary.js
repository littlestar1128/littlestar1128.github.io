/* global hexo */
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Local override of Butterfly 5.7's post view. The summary stays out of the
// article HTML used by search, the table of contents and other generators.
hexo.extend.filter.register('before_generate', () => {
  if (hexo.config.theme !== 'butterfly') return;
  const layout = readFileSync(join(hexo.base_dir, 'layouts', 'post.pug'), 'utf8');
  hexo.theme.setView('post.pug', layout);
});
