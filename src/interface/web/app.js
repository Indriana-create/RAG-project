import { api } from './api.js';

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

function addMessage(role, text, sources = []) {
  $('welcome')?.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text; // textContent: aman dari XSS
  if (sources.length) {
    const box = document.createElement('div');
    box.className = 'sources';
    for (const s of sources) { const chip = document.createElement('span'); chip.textContent = `📄 ${s.title}`; box.append(chip); }
    el.append(box);
  }
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
  const typing = addTyping();
  try {
    const reply = await api.ask(sessionId, question);
    typing.remove();
    addMessage('assistant', reply.content, reply.sources);
  } catch (err) {
    typing.remove();
    addMessage('assistant', err.message, []).classList.add('error');
  } finally {
    sendBtn.disabled = false; input.focus();
  }
}

form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; });
document.querySelectorAll('.suggestions button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
$('clear').addEventListener('click', async () => {
  await api.clear(sessionId).catch(() => {});
  location.reload();
});

// Pulihkan riwayat sesi
api.history(sessionId).then((items) => items.forEach((m) => addMessage(m.role, m.content, m.sources))).catch(() => {});
