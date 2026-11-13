'use strict';
/*
 * テーマ (themes/jpazure) の見た目と表示内容を調整する。テーマのファイルは変更しない。
 * 見た目の上書きは source/css/custom.css にある。
 */
const fs = require('fs');
const path = require('path');

// テーマのテンプレートを読み、文字列を置き換えたものを登録する (テーマ側は変更しない)
// テーマ側のファイルが見つからない場合は警告して、その調整だけを飛ばす (ビルドは止めない)
function patchView(name, pairs) {
  let src;
  try {
    src = fs.readFileSync(path.join(hexo.theme_dir, 'layout', name), 'utf8');
  } catch (e) {
    hexo.log.warn(`[custom-style] テーマの ${name} が見つからないため、この調整を飛ばします`);
    return;
  }
  for (const [from, to] of pairs) {
    if (!src.includes(from)) hexo.log.warn(`[custom-style] "${from}" が ${name} に見つかりません`);
    src = src.split(from).join(to);
  }
  hexo.theme.setView(name, src);
}

// 注意書き ([!NOTE] など) を HTML に変換する。ビルドツールの hexo-alert は本文だけが対象で
// 記事一覧の抜粋や説明文には効かず、CAUTION も対象外のため、ここで補う
const ALERTS = {
  NOTE: ['is-info', 'Note'], TIP: ['is-success', 'ヒント'], IMPORTANT: ['is-important', '重要'],
  CAUTION: ['is-caution', '注意事項'], WARNING: ['is-warning', '警告'],
};
// 大文字・小文字の違い、記号の前の空白、注意書きの中の箇条書きにも対応する
const ALERT_RE = /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*(?:<br>)?\s*([^]*?)<\/blockquote>/gi;
function convertAlerts(html) {
  return html.replace(ALERT_RE, (_, type, body) => {
    const [cls, title] = ALERTS[type.toUpperCase()];
    // 1 段落目の改行 (<br>) は段落として分ける
    const firstEnd = body.indexOf('</p>');
    const first = firstEnd === -1 ? body : body.slice(0, firstEnd);
    const rest = firstEnd === -1 ? '' : body.slice(firstEnd + 4);
    const paras = first.split('<br>').map(t => t.trim()).filter(Boolean).map(t => `<p>${t}</p>`).join('');
    return `<div class="alert ${cls}"><p class="alert-title">${title}</p>${paras}${rest}</div>`;
  });
}
hexo.extend.filter.register('after_post_render', data => {
  data.content = convertAlerts(data.content)
    // 表をスクロール可能な枠で囲む (スマホで右側が切れるのを防ぐ)
    .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  if (data.excerpt) data.excerpt = convertAlerts(data.excerpt).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return data;
}, 20);

// 記事の更新日: ビルド時に Git の履歴から求める
// (これまではページを開くたびに読者のブラウザから GitHub API を呼んでいた)
const { execFileSync } = require('child_process');
let gitDates = null;
function loadGitDates() {
  const cwd = hexo.base_dir;
  const git = args => execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
      hexo.log.warn('[custom-style] Git の履歴が浅いため、更新日はブラウザで取得します (checkout の fetch-depth: 0 が必要)');
      return {};
    }
    const map = {};
    let date = null;
    for (const line of git(['log', '--no-merges', '--format=@%aI', '--name-only', '--', 'articles']).split('\n')) {
      if (line.startsWith('@')) date = line.slice(1, 11);
      else if (line && date && !(line in map)) map[line] = date;
    }
    return map;
  } catch (e) {
    hexo.log.warn('[custom-style] Git の履歴を読めないため、更新日はブラウザで取得します');
    return {};
  }
}
hexo.extend.helper.register('article_last_updated', sourceUrl => {
  if (!gitDates) gitDates = loadGitDates();
  const m = /\/(articles\/.+)$/.exec(sourceUrl || '');
  return m ? gitDates[decodeURI(m[1])] || '' : '';
});

// 画像は画面に近づいてから読み込む (先頭の 1 枚を除く)。元の画像はそのまま使い、クリックで原寸表示できる。
// テーマの JavaScript が表示後に画像をリンクで包み直すと遅延読み込みが解除されるため、その処理をビルド時に済ませる
// 画像ファイルの縦横サイズを読む (PNG / JPEG / GIF。追加のパッケージは使わない)
function imageSize(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}
function addImageSize(img) {
  if (/\swidth=/.test(img)) return img;
  const src = (/\ssrc="([^"]*)"/.exec(img) || [])[1] || '';
  const root = hexo.config.root || '/';
  if (!src.startsWith(root) || /^[a-z]+:/i.test(src)) return img;
  const rel = decodeURIComponent(src.slice(root.length).split(/[?#]/)[0]);
  const size = imageSize(path.join(hexo.source_dir, '_posts', rel)) || imageSize(path.join(hexo.source_dir, rel));
  return size ? img.replace('<img', `<img width="${size[0]}" height="${size[1]}"`) : img;
}

const escAttr = v => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
hexo.extend.filter.register('after_post_render', data => {
  let n = 0;
  data.content = data.content.replace(/(<a\b[^>]*>\s*)?(<img\b[^>]*>)/g, (m, a, img) => {
    img = addImageSize(img);
    if (n++ > 0 && !/\sloading=/.test(img)) img = img.replace('<img', '<img loading="lazy" decoding="async"');
    if (a) return a + img;                          // すでにリンクの中にある画像はそのまま
    const src = (/\ssrc="([^"]*)"/.exec(img) || [])[1] || '';
    const alt = (/\salt="([^"]*)"/.exec(img) || [])[1] || '';
    return `<a href="${src}" title="${alt}" class="fancybox">${img}</a>` + (alt ? `<span class="caption">${alt}</span>` : '');
  });
  return data;
}, 21);

// 1. 上書き用の CSS を読み込む
hexo.extend.injector.register('head_end', () =>
  `<link rel="stylesheet" href="${hexo.config.root}css/custom.css">`);

hexo.extend.filter.register('before_generate', () => {
  // 2. サイドバーの並び。テーマ既定と _config.yml の配列が結合されてしまうため、ここで確定させる
  hexo.theme.config.widgets = ['category', 'recent_posts', 'tag'];

  // 3. 最近の投稿: 日付を添え、項目の区切りを付けられるようにする
  hexo.theme.setView('_widget/recent_posts.ejs', `
<% if (site.posts.length){ %>
<div class="widget-wrap">
  <h3 class="widget-title"><%= __('recent_posts') %></h3>
  <div class="widget">
    <ul class="recent-post-list">
      <% site.posts.sort('date', -1).limit(5).each(function(post){ %>
      <li class="recent-post-item">
        <a class="recent-post-link" href="<%- url_for(post.path) %>"><%= post.title || '(no title)' %></a>
        <time class="recent-post-date" datetime="<%= date_xml(post.date) %>"><%= date(post.date, 'YYYY-MM-DD') %></time>
      </li>
      <% }) %>
    </ul>
  </div>
</div>
<% } %>`);

  // 4. タグ: _config.yml の root_tag_names の順で、件数付きのチップとして表示する
  hexo.theme.setView('_widget/tag.ejs', `
<% var names = (config.root_tag_generator && config.root_tag_generator.root_tag_names) || []; %>
<% var tags = names.map(function(n){ return site.tags.findOne({ name: n }); }).filter(function(t){ return t && t.length; }); %>
<% if (tags.length){ %>
<div class="widget-wrap">
  <h3 class="widget-title"><%= __('tags') %></h3>
  <div class="widget">
    <ul class="tag-chip-list">
      <% tags.forEach(function(t){ %>
      <li><a class="tag-chip" href="<%- url_for(t.path) %>"><%= t.name %><span class="tag-chip-count"><%= t.length %></span></a></li>
      <% }) %>
    </ul>
  </div>
</div>
<% } %>`);
  // 5. 記事のカテゴリ: 「親 › 子」の組ごとにまとめて表示する
  //    (テーマ既定は全カテゴリを ► でつなぐため、別々のカテゴリが 1 本の階層に見えてしまう)
  hexo.theme.setView('_partial/post/category.ejs', `
<% if (post.categories && post.categories.length){ %>
<% var cats = post.categories.toArray();
   var parentIds = cats.map(function(c){ return c.parent; }).filter(Boolean);
   var leaves = cats.filter(function(c){ return parentIds.indexOf(c._id) === -1; }); %>
<div class="article-category">
  <% leaves.forEach(function(leaf){
       var path = [leaf], cur = leaf;
       while (cur.parent) { cur = site.categories.findOne({ _id: cur.parent }); if (!cur) break; path.unshift(cur); } %>
  <span class="category-chip"><% path.forEach(function(c, i){ %><% if (i) { %><span class="category-chip-sep">›</span><% } %><a class="article-category-link" href="<%- url_for(c.path) %>"><%= c.name %></a><% }) %></span>
  <% }) %>
</div>
<% } %>`);

  // 6. カテゴリ・タグのページに、どのカテゴリ・タグの一覧かを表示する
  hexo.theme.setView('category.ejs', `<h2 class="archive-page-title"><span>カテゴリ</span><%= page.category %></h2>
<%- partial('_partial/archive', {pagination: config.category, index: true}) %>`);
  hexo.theme.setView('tag.ejs', `<h2 class="archive-page-title"><span>タグ</span><%= page.tag %></h2>
<%- partial('_partial/archive', {pagination: config.tag, index: true}) %>`);

  // 7. 一覧の日付を記事ページと同じ YYYY-MM-DD にそろえる
  patchView('_partial/archive-post.ejs', [["'YYYY / M / D'", "'YYYY-MM-DD'"]]);
  patchView('_partial/all-articles-post.ejs', [["'YYYY/ M / D'", "'YYYY-MM-DD'"]]);

  // 8. 表示の日本語化
  patchView('_partial/article.ejs', [
    // 「公開日:」と日付を 1 つにまとめ、更新日・執筆者と同じ高さにそろえる
    ['Published: ', '<span class="article-published">公開日: '],
    ["{class_name: 'article-date-single', date_format: null}) %>", "{class_name: 'article-date-single', date_format: null}) %></span>"],
    ['>feedback</a>', '>フィードバック</a>'],
  ]);
  patchView('_partial/post/githubinfo.ejs', [['/ Last update:', '/ 更新日:'], ['/ Contributors:', '/ 執筆者:']]);
  hexo.theme.config.excerpt_link = '続きを読む';
  hexo.theme.config.menu = { 'ホーム': '/', '記事一覧': 'archives' };

  // 9. スマホのメニューに検索と「サポート情報」を追加する
  hexo.theme.setView('_partial/mobile-nav.ejs', `<nav id="mobile-nav">
  <form class="mobile-search" onsubmit="var q=this.q.value;if(q){window.open('https://www.bing.com/search?q='+encodeURIComponent(q+' site:<%- config.url.replace(/\\/$/, '') %>'),'_blank')};return false;">
    <input type="search" name="q" placeholder="ブログ内を検索" aria-label="ブログ内を検索">
  </form>
  <% for (var i in theme.menu){ %>
    <a href="<%- url_for(theme.menu[i]) %>" class="mobile-nav-link"><%= i %></a>
  <% } %>
  <a href="https://cssjpn.github.io/" class="mobile-nav-link">サポート情報</a>
</nav>`);

  // 10. 更新日・執筆者の表示。更新日はビルド時の値を使い、取れない場合だけブラウザで取得する。
  //     執筆者のアイコンは GitHub API から取得し、失敗したら欄ごと隠す。同じタブの中では結果を使い回す
  hexo.theme.setView('_partial/post/githubinfo.ejs', `<% var updated = article_last_updated(source_url); %>
<span class="article-updated"<%- updated ? '' : ' hidden' %>>/ 更新日: <span id="update-time" class="<%= class_name %>"><%= updated %></span></span>
<span class="article-contributors" hidden>/ 執筆者: <ul id="contributors" class="github-contributors"></ul></span>
<script>
(function () {
  var parts = "<%- source_url %>".split("/");
  var apiUrl = "https://api.github.com/repos/" + parts[3] + "/" + parts[4] + "/commits?path=" + parts.slice(7).join("/");
  var key = "gh-commits:" + apiUrl, hasDate = <%- updated ? 'true' : 'false' %>;
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function render(list) {
    if (!Array.isArray(list) || !list.length) return;
    if (!hasDate && list[0].date) {
      var d = new Date(list[0].date);
      document.getElementById("update-time").textContent = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      document.querySelector(".article-updated").hidden = false;
    }
    var seen = {}, html = "";
    list.slice().reverse().forEach(function (c) {
      if (!c.login || seen[c.login]) return;
      seen[c.login] = true;
      html += '<li class="contributor-avatar"><a href="https://github.com/' + c.login + '" title="' + c.login + '"><img src="' + c.avatar + '" alt="' + c.login + '" loading="lazy"></a></li>';
    });
    if (html) { document.getElementById("contributors").innerHTML = html; document.querySelector(".article-contributors").hidden = false; }
  }
  try { var cached = sessionStorage.getItem(key); if (cached) { render(JSON.parse(cached)); return; } } catch (e) {}
  fetch(apiUrl).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!Array.isArray(data)) return;
    var list = data.map(function (x) {
      return { date: x.commit && x.commit.author && x.commit.author.date, login: x.author && x.author.login, avatar: x.author && x.author.avatar_url };
    });
    try { sessionStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
    render(list);
  }).catch(function () {});
})();
</script>`);
  // 11. 日付をリンクにしない (テーマは日付を記事へのリンクにしており、日付に関する一覧が開くように見えるため)
  hexo.theme.setView('_partial/post/date.ejs', `<span class="<%= class_name %>">
  <time datetime="<%= date_xml(post.date) %>" itemprop="datePublished"><%= date(post.date, date_format) %></time>
</span>`);
});
