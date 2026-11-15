/*
 * site.js — 官网唯一的脚本（手写，无依赖）。没有它页面照样能读：导航折到第二行，语言菜单是原生 <details>。
 * 1. 外观：跟随系统 / 明亮 / 暗黑三态循环，选择记在 localStorage["jobs.theme"]（首帧前由 <head> 里的内联脚本应用）。
 * 2. 语言：点语言菜单里的一项时记下 localStorage["jobs.lang"]；默认语言首页的内联脚本据此跳转。
 * 3. 语言菜单：点外面或按 Esc 关闭。
 * 4. 窄屏的菜单按钮。
 * 5. 复制安装命令。
 * 6. 示意图：滑进视口才开始动，滑出去就停（没有脚本时一直在动）。
 */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var THEME_KEY = 'jobs.theme';
  var LANG_KEY = 'jobs.lang';

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (e) { /* 隐私模式下写不进去：只影响下次打开 */ } }

  /* ---- 1. 外观 */
  function initTheme() {
    var button = doc.querySelector('[data-theme-toggle]');
    if (!button) return;
    var order = ['system', 'light', 'dark'];
    var state = read(THEME_KEY);
    if (state !== 'light' && state !== 'dark') state = 'system';
    function render() {
      if (state === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', state);
      var label = button.getAttribute('data-label') + ': ' + button.getAttribute('data-label-' + state);
      button.setAttribute('data-state', state);
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
    button.addEventListener('click', function () {
      state = order[(order.indexOf(state) + 1) % order.length];
      write(THEME_KEY, state === 'system' ? null : state);
      render();
    });
    render();
    button.hidden = false;
  }

  /* ---- 2. 语言 */
  function initLang() {
    var links = doc.querySelectorAll('[data-set-lang]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (ev) { write(LANG_KEY, ev.currentTarget.getAttribute('data-set-lang')); });
    }
  }

  /* ---- 3. 语言菜单 */
  function initLangMenu() {
    var menu = doc.querySelector('.lang-menu');
    if (!menu) return;
    doc.addEventListener('click', function (ev) { if (menu.open && !menu.contains(ev.target)) menu.open = false; });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
  }

  /* ---- 4. 窄屏菜单 */
  function initMenu() {
    var button = doc.querySelector('[data-menu-toggle]');
    var nav = doc.getElementById('site-nav');
    if (!button || !nav) return;
    function set(open) {
      nav.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', button.getAttribute(open ? 'data-label-close' : 'data-label-open'));
    }
    button.addEventListener('click', function () { set(button.getAttribute('aria-expanded') !== 'true'); });
    nav.addEventListener('click', function (ev) { if (ev.target.closest('a')) set(false); });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { set(false); button.focus(); }
    });
    button.hidden = false;
  }

  /* ---- 5. 复制 */
  function initCopy() {
    var buttons = doc.querySelectorAll('[data-copy]');
    for (var i = 0; i < buttons.length; i++) bind(buttons[i]);
    function bind(button) {
      var source = doc.getElementById(button.getAttribute('data-copy'));
      var label = button.querySelector('span');
      var timer = 0;
      if (!source || !navigator.clipboard) { button.hidden = true; return; }
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(source.textContent).then(function () {
          button.classList.add('is-copied');
          if (label) label.textContent = button.getAttribute('data-label-copied');
          clearTimeout(timer);
          timer = setTimeout(function () {
            button.classList.remove('is-copied');
            if (label) label.textContent = button.getAttribute('data-label-copy');
          }, 1600);
        }, function () { /* 没有权限：命令本身可以直接选中复制 */ });
      });
    }
  }

  /* ---- 6. 示意图 */
  function initFigures() {
    var figs = doc.querySelectorAll('.fig');
    if (!('IntersectionObserver' in window)) { for (var i = 0; i < figs.length; i++) figs[i].classList.add('is-live'); return; }
    var seen = new IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) entries[j].target.classList.toggle('is-live', entries[j].isIntersecting);
    }, { threshold: 0.25 });
    for (var k = 0; k < figs.length; k++) seen.observe(figs[k]);
  }

  initTheme();
  initLang();
  initLangMenu();
  initMenu();
  initCopy();
  initFigures();
})();
