import { api } from './api.js';
import { initI18n, language, onLanguageChange, t } from './i18n.js';

initI18n();

const $ = (id) => document.getElementById(id);
const messagesEl = $('messages'), form = $('form'), input = $('input'), sendBtn = $('send');

function getSessionId() {
  try {
    let id = localStorage.getItem('sessionId');
    if (!id) localStorage.setItem('sessionId', (id = crypto.randomUUID()));
    return id;
  } catch { return crypto.randomUUID(); }
}
let sessionId = getSessionId();

/** Hanya http/https yang dijadikan tautan (mencegah javascript:, data:, dst.). */
function safeHref(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function newLink(href, label, className) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  if (className) a.className = className;
  return a;
}

// Teks jawaban dirender lewat node DOM (bukan innerHTML): **tebal**, butir daftar ("* " / "- " di awal baris),
// dan alamat web menjadi tautan. Tanda baca di ujung alamat (titik, koma, kurung) tidak ikut tertaut.
const INLINE = /\*\*([^*\n]+?)\*\*|https?:\/\/[^\s<>"']+/g;
function renderText(target, text) {
  const nodes = [];
  const lines = text.split('\n').map((line) => line.replace(/^(\s*)[*\u2022-]\s+(?=\S)/, '$1\u2022 '));
  const source = lines.join('\n');
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    if (m[1] !== undefined) {
      if (m.index > last) nodes.push(source.slice(last, m.index));
      const strong = document.createElement('strong');
      strong.textContent = m[1];
      nodes.push(strong);
      last = m.index + m[0].length;
      continue;
    }
    const url = m[0].replace(/[.,;:!?)\]}]+$/, '');
    const href = safeHref(url);
    if (!href) continue;
    if (m.index > last) nodes.push(source.slice(last, m.index));
    nodes.push(newLink(href, url, 'inline-link'));
    last = m.index + url.length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  target.replaceChildren(...nodes);
}

function renderSources(el, sources) {
  if (!sources.length) return;
  const box = document.createElement('div');
  box.className = 'sources';
  for (const s of sources) {
    const href = s.url && safeHref(s.url);
    if (href) {
      const chip = newLink(href, `📄 ${s.title} ↗`, 'source-link');
      chip.title = href;
      box.append(chip);
    } else {
      const chip = document.createElement('span');
      chip.textContent = `📄 ${s.title}`;
      box.append(chip);
    }
  }
  el.append(box);
}

function addMessage(role, text, sources = []) {
  $('welcome')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  renderText(el, text); // node teks/anchor, bukan innerHTML: aman dari XSS
  renderSources(el, sources);
  messagesEl.append(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function addTyping() {
  const el = addMessage('assistant', '');
  el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  return el;
}

async function send(question) {
  if (!question.trim()) return;
  addMessage('user', question);
  input.value = ''; input.style.height = 'auto';
  sendBtn.disabled = true;
  const el = addTyping();
  let body = null;
  try {
    const reply = await api.askStream(sessionId, question, {
      onToken: (text) => {
        if (!body) { body = document.createElement('span'); el.replaceChildren(body); }
        body.textContent += text;
        const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
        if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
      },
    });
    if (body) renderText(body, body.textContent); // setelah selesai, alamat web dalam jawaban menjadi tautan
    renderSources(el, reply.sources);
  } catch (err) {
    el.classList.add('error');
    if (body) body.textContent += `\n\n⚠ ${err.message}`;
    else renderText(el, err.message);
  } finally {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    sendBtn.disabled = false; input.focus();
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; });

// Saran pertanyaan di layar awal: yang diatur admin; bila belum ada, dibuat dari judul knowledge aktif.
let suggestionData = { suggestions: { id: [], en: [] }, topics: [] };
function renderSuggestions() {
  const box = $('suggestions');
  if (!box) return;
  // Daftar admin untuk bahasa yang dipilih; bila kosong, daftar bahasa lainnya; bila tak ada sama sekali, dari judul knowledge.
  const lang = language();
  const configured = suggestionData.suggestions[lang]?.length ? suggestionData.suggestions[lang]
    : suggestionData.suggestions[lang === 'id' ? 'en' : 'id'] ?? [];
  const items = configured.length
    ? configured
    : suggestionData.topics.slice(0, 4).map((title) => t('chat.aboutTopic', { title }));
  box.replaceChildren(...items.map((text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => send(text));
    return b;
  }));
}
onLanguageChange(renderSuggestions);
api.suggestions().then((data) => { suggestionData = data; renderSuggestions(); }).catch(() => {});
$('clear').addEventListener('click', async () => {
  await api.clear(sessionId).catch(() => {});
  location.reload();
});

// Pulihkan riwayat sesi
api.history(sessionId).then((items) => items.forEach((m) => addMessage(m.role, m.content, m.sources))).catch(() => {});
