// works.js
// Lädt alle Markdown-Arbeiten aus /pages, zeigt sie als gekürzte Einträge
// und öffnet beim Klick die komplette Arbeit in einem Overlay-Fenster.
//
// Welche Dateien es gibt, steht in pages/index.json
// (wird mit tools/build_index.py automatisch erzeugt).

const PAGES_DIR = 'pages/';
const EXCERPT_CHARS = 200;

// ---------- Hilfsfunktionen ----------

// Front Matter (--- title: ... ---) vom Markdown trennen
function parseFrontMatter(text) {
  const match = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  match[1].split(/\r?\n/).forEach(line => {
    const i = line.indexOf(':');
    if (i === -1) return;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    if (key) meta[key] = value;
  });
  return { meta, body: text.slice(match[0].length) };
}

// Datum "2026-02-29" -> "29. Feb 2026"
function formatDate(value) {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return value;
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  return `${parseInt(m[3], 10)}. ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

// Relative Pfade (z. B. markdown_assets/bild.jpg) auf pages/ umbiegen
function resolvePath(path) {
  if (!path || /^([a-z]+:|\/|#)/i.test(path)) return path;
  return PAGES_DIR + path.replace(/^\.\//, '');
}

function fixRelativeLinks(container) {
  container.querySelectorAll('img[src], video[src], source[src], audio[src]').forEach(el => {
    el.setAttribute('src', resolvePath(el.getAttribute('src')));
  });
  container.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href');
    el.setAttribute('href', resolvePath(href));
    if (/^https?:/i.test(href)) el.target = '_blank';
  });
}

// Markdown -> reiner Text für die Kurzfassung
function toPlainText(markdownBody) {
  const tmp = document.createElement('div');
  tmp.innerHTML = marked.parse(markdownBody);
  tmp.querySelectorAll('img, video, audio, iframe, h1').forEach(el => el.remove());
  return tmp.textContent.replace(/\s+/g, ' ').trim();
}

function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + ' […]';
}

// Erstes Bild im Markdown finden (falls kein "cover" gesetzt ist)
function firstImage(markdownBody) {
  const m = markdownBody.match(/!\[[^\]]*\]\(\s*([^)\s]+)/);
  return m ? m[1] : null;
}

// ---------- Dateien laden ----------

async function loadFileList() {
  // 1. pages/index.json (empfohlen)
  try {
    const res = await fetch(PAGES_DIR + 'index.json', { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) return list;
    }
  } catch (e) { /* weiter zu Plan B */ }

  // 2. Fallback: Verzeichnis-Listing des Servers auslesen
  //    (funktioniert z. B. mit "python -m http.server" oder Apache)
  try {
    const res = await fetch(PAGES_DIR);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('a[href]')]
      .map(a => decodeURIComponent(a.getAttribute('href').split('/').pop()))
      .filter(name => name.endsWith('.md') && !name.startsWith('_'));
  } catch (e) {
    return [];
  }
}

async function loadWorks() {
  const files = await loadFileList();

  const works = await Promise.all(files.map(async file => {
    try {
      const res = await fetch(PAGES_DIR + encodeURIComponent(file));
      if (!res.ok) return null;
      const { meta, body } = parseFrontMatter(await res.text());

      const slug = file.replace(/\.md$/i, '');
      const h1 = body.match(/^#\s+(.+)$/m);
      return {
        slug,
        file,
        body,
        title: meta.title || (h1 ? h1[1].trim() : slug),
        date: meta.date || '',
        cover: meta.cover || firstImage(body),
        excerpt: meta.excerpt || shorten(toPlainText(body), EXCERPT_CHARS)
      };
    } catch (e) {
      return null;
    }
  }));

  // Neueste zuerst
  return works.filter(Boolean).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// ---------- Liste (Kurzfassung) ----------

function renderTeaser(work) {
  const article = document.createElement('article');
  article.className = 'post post-teaser';
  article.tabIndex = 0;
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `${work.title} öffnen`);

  article.innerHTML = `
    <header class="post-header">
      <div class="post-title"></div>
      <div class="post-date"></div>
    </header>
    ${work.cover ? '<div class="post-image"><img alt=""></div>' : ''}
    <div class="post-body"><p></p></div>
    <div class="post-more">weiterlesen →</div>
  `;
  article.querySelector('.post-title').textContent = work.title;
  article.querySelector('.post-date').textContent = formatDate(work.date);
  article.querySelector('.post-body p').textContent = work.excerpt;
  if (work.cover) {
    const img = article.querySelector('.post-image img');
    img.src = resolvePath(work.cover);
    img.alt = work.title;
  }

  const open = () => openWork(work);
  article.addEventListener('click', open);
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return article;
}

// ---------- Overlay-Fenster (komplette Arbeit) ----------

let overlay;
let lastFocus;

function buildOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'work-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="work-window" role="dialog" aria-modal="true" aria-labelledby="work-window-title">
      <div class="work-window-bar">
        <div class="work-window-title" id="work-window-title"></div>
        <button class="work-window-close" type="button" aria-label="Schließen">×</button>
      </div>
      <div class="work-window-content">
        <div class="post-date"></div>
        <div class="markdown-body"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.work-window-close').addEventListener('click', closeWork);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWork(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hidden) closeWork();
  });
}

function openWork(work, updateHash = true) {
  if (!overlay) buildOverlay();
  lastFocus = document.activeElement;

  overlay.querySelector('.work-window-title').textContent = work.title;
  overlay.querySelector('.work-window-content .post-date').textContent = formatDate(work.date);

  const content = overlay.querySelector('.markdown-body');
  content.innerHTML = marked.parse(work.body);
  fixRelativeLinks(content);

  overlay.hidden = false;
  document.body.classList.add('no-scroll');
  overlay.querySelector('.work-window-content').scrollTop = 0;
  overlay.querySelector('.work-window-close').focus();

  if (updateHash) history.pushState(null, '', '#' + encodeURIComponent(work.slug));
}

function closeWork(updateHash = true) {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  document.body.classList.remove('no-scroll');
  if (updateHash && location.hash) history.pushState(null, '', location.pathname + location.search);
  if (lastFocus) lastFocus.focus();
}

// ---------- Start ----------

// options.limit: nur die neuesten X Arbeiten anzeigen (z. B. auf der Startseite)
async function initWorks(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let works = await loadWorks();

  if (!works.length) {
    container.innerHTML = '<p class="works-empty">Noch keine Arbeiten vorhanden.</p>';
    return;
  }

  const all = works;
  if (options.limit) works = works.slice(0, options.limit);
  container.innerHTML = '';
  works.forEach(work => container.appendChild(renderTeaser(work)));

  // Direktlink: works.html#reflektoskop öffnet die Arbeit sofort
  const openFromHash = () => {
    const slug = decodeURIComponent(location.hash.slice(1));
    const work = all.find(w => w.slug === slug);
    if (work) openWork(work, false);
    else closeWork(false);
  };
  window.addEventListener('popstate', openFromHash);
  openFromHash();
}
