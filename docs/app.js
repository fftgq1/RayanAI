const CFG = window.__APP_CONFIG__ || {};
const API_BASE = (CFG.API_BASE || "").replace(/\/+$/,"");

function el(id){ return document.getElementById(id); }

const THEME_KEY = "rayanai_theme_v1";
let currentMode = "tutor";
let lastSessionId = "default";

function toast(msg){
  const t = el("toast");
  t.textContent = msg;
  t.style.display = "";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.style.display = "none", 2000);
}
function setTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  setTheme(saved || "light");
}
function nowTime(){
  const d = new Date();
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function autoSizeTextarea(t){
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 180) + "px";
}

async function apiGet(path){
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPost(path, payload){
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload),
    credentials: "include"
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function setEnabled(enabled){
  el("noteText").disabled = !enabled;
  el("ingestBtn").disabled = !enabled;
  el("pdfTitle").disabled = !enabled;
  el("pdfBtn").disabled = !enabled;
  el("message").disabled = !enabled;
  el("sendBtn").disabled = !enabled;
  el("pdfFile").disabled = !enabled;
  el("message").placeholder = enabled ? "Ask a study question…" : "Sign in to start…";
}

function addMessage(role, text){
  const chat = el("chat");
  const row = document.createElement("div");
  row.className = "msgRow " + (role === "user" ? "user" : "assistant");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span class="roleTag">${role === "user" ? "You" : "RayanAI"}</span><span>${nowTime()}</span>`;

  bubble.appendChild(meta);
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function addThinking(){
  const chat = el("chat");
  const row = document.createElement("div");
  row.className = "msgRow assistant";
  row.innerHTML = `<div class="bubble">Thinking…</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  return row;
}

const modeConfig = {
  tutor: {hint:"Tutor mode: clear explanations + practice.", prefix:"Act as a rigorous university tutor. Explain clearly, then give a worked example and 3 practice questions.\n\n"},
  exam: {hint:"Exam mode: exam-style guidance + marking scheme.", prefix:"Help me prepare for an exam. Provide exam-style guidance, common mistakes, and a short marking scheme.\n\n"},
  summarize: {hint:"Summarize mode: key points + what to memorize.", prefix:"Summarize into key points, definitions, and what to memorize. Keep it structured.\n\n"},
  flashcards: {hint:"Flashcards mode: Q/A pairs.", prefix:"Create flashcards as concise Q/A pairs. Keep them exam-focused.\n\n"}
};

function setMode(mode){
  currentMode = mode;
  el("modeHint").textContent = modeConfig[mode].hint;
  document.querySelectorAll(".chip[data-mode]").forEach(ch =>
    ch.classList.toggle("active", ch.dataset.mode === mode)
  );
}

let sessionsCache = [];

function renderSessions(filter=""){
  const box = el("sessions");
  box.innerHTML = "";
  const f = (filter || "").toLowerCase().trim();
  const list = sessionsCache.filter(s => !f || s.session_id.toLowerCase().includes(f));

  list.forEach(s => {
    const item = document.createElement("div");
    item.className = "sessionItem" + (s.session_id === lastSessionId ? " active" : "");
    item.innerHTML = `
      <div class="sessionMeta">
        <div class="sessionTitle">${s.session_id}</div>
        <div class="sessionSub">${s.turns} turns</div>
      </div>
    `;
    item.addEventListener("click", async () => { await openSession(s.session_id); });
    box.appendChild(item);
  });
}

async function refreshSessions(){
  const j = await apiGet("/api/sessions");
  sessionsCache = j.sessions || [];
  renderSessions(el("sessionSearch").value || "");
}

async function openSession(sessionId){
  lastSessionId = sessionId;
  el("chat").innerHTML = "";
  const j = await apiGet(`/api/session/${encodeURIComponent(sessionId)}/messages?limit=200`);
  const msgs = j.messages || [];
  msgs.forEach(m => addMessage(m.role === "user" ? "user" : "assistant", m.content));
  await refreshSessions();
}

async function checkHealth(){
  try{
    const j = await apiGet("/health");
    el("healthPill").textContent = "OK";
    el("healthPill").style.color = "var(--ok)";
    el("backendName").textContent = j.backend || "online";
    el("ocrHint").textContent = `OCR: ${j.ocr_enabled ? "enabled" : "disabled"}`;
  }catch{
    el("healthPill").textContent = "Backend offline";
    el("healthPill").style.color = "var(--bad)";
    el("backendName").textContent = "offline";
    el("ocrHint").textContent = "OCR: unknown";
  }
}

async function checkAuth(){
  try{
    const j = await apiGet("/auth/me");
    const u = j.user || {};
    el("authStatus").textContent = `Signed in: ${u.name || u.email || "student"}`;
    el("loginBtn").style.display = "none";
    el("logoutBtn").style.display = "block";
    setEnabled(true);
    await refreshSessions();
  }catch{
    el("authStatus").textContent = "Not signed in";
    el("loginBtn").style.display = "block";
    el("logoutBtn").style.display = "none";
    setEnabled(false);
  }
}

async function send(){
  const msg = el("message").value.trim();
  if (!msg) return;

  const session_id = lastSessionId || "default";
  addMessage("user", msg);
  el("message").value = "";
  autoSizeTextarea(el("message"));

  const thinking = addThinking();
  try{
    const out = await apiPost("/api/chat", {
      session_id,
      message: modeConfig[currentMode].prefix + msg
    });
    thinking.remove();
    addMessage("assistant", out.answer || "No answer");
    await refreshSessions();
  }catch(e){
    thinking.remove();
    addMessage("assistant", `Error: ${e.message}`);
  }
}

function uploadWithProgress(url, formData, onProgress){
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${url}`, true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      onProgress(Math.round((evt.loaded / evt.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300){
        try { resolve(JSON.parse(xhr.responseText)); }
        catch{ reject(new Error("Bad JSON response")); }
      } else reject(new Error(xhr.responseText || `Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}

async function handlePdf(file){
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) return toast("Pick a PDF");
  const wrap = el("pdfProgressWrap");
  const fill = el("pdfProgressFill");
  const txt = el("pdfProgressText");
  wrap.style.display = "";
  fill.style.width = "0%";
  txt.textContent = "Uploading…";

  const title = el("pdfTitle").value.trim() || file.name;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("title", title);

  try{
    const out = await uploadWithProgress("/api/upload_pdf", fd, (pct) => {
      fill.style.width = pct + "%";
      txt.textContent = `Uploading… ${pct}%`;
    });
    wrap.style.display = "none";
    el("pdfStatus").textContent = `PDF added ✅ (${out.note_id})`;
    el("pdfStatus").style.color = "var(--ok)";
  }catch(e){
    wrap.style.display = "none";
    el("pdfStatus").textContent = `Error: ${e.message}`;
    el("pdfStatus").style.color = "var(--bad)";
  }
}

function wireDrop(){
  const zone = el("dropZone");
  const input = el("pdfFile");
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.style.opacity = "0.85"; });
  zone.addEventListener("dragleave", () => { zone.style.opacity = "1"; });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.style.opacity = "1";
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handlePdf(file);
  });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) handlePdf(file);
  });
}

el("loginBtn").addEventListener("click", () => window.location.href = `${API_BASE}/auth/login`);
el("logoutBtn").addEventListener("click", async () => { await apiPost("/auth/logout", {}); await checkAuth(); });

el("themeBtn").addEventListener("click", () => {
  const cur = localStorage.getItem(THEME_KEY) || "light";
  setTheme(cur === "dark" ? "light" : "dark");
});

document.querySelectorAll(".chip[data-mode]").forEach(ch => ch.addEventListener("click", () => setMode(ch.dataset.mode)));

el("newChatBtn").addEventListener("click", async () => {
  const id = "chat-" + new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
  await openSession(id);
  toast("New chat created");
});

el("exportBtn").addEventListener("click", () => {
  const sid = lastSessionId || "default";
  window.open(`${API_BASE}/api/session/${encodeURIComponent(sid)}/export.md`, "_blank");
});

el("sessionSearch").addEventListener("input", () => renderSessions(el("sessionSearch").value));

el("attachBtn").addEventListener("click", () => toast("Use the Upload panel on the right."));

el("message").addEventListener("input", () => autoSizeTextarea(el("message")));
el("message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    send();
  }
});
el("sendBtn").addEventListener("click", send);

el("ingestBtn").addEventListener("click", async () => {
  el("ingestStatus").textContent = "Uploading…";
  try{
    const out = await apiPost("/api/ingest", {
      title: el("noteTitle").value.trim() || "Notes",
      text: el("noteText").value || ""
    });
    el("ingestStatus").textContent = `Added ✅ (${out.note_id})`;
    el("ingestStatus").style.color = "var(--ok)";
    el("noteText").value = "";
  }catch(e){
    el("ingestStatus").textContent = `Error: ${e.message}`;
    el("ingestStatus").style.color = "var(--bad)";
  }
});

el("pdfBtn").addEventListener("click", async () => {
  const f = el("pdfFile").files && el("pdfFile").files[0];
  if (!f) return toast("Choose a PDF first");
  await handlePdf(f);
});

function openSidebar(){ el("sidebar").classList.add("open"); }
function closeSidebar(){ el("sidebar").classList.remove("open"); }
el("openSidebar").addEventListener("click", openSidebar);
el("closeSidebar").addEventListener("click", closeSidebar);

async function init(){
  if (!API_BASE) toast("Set API_BASE in docs/config.js");
  initTheme();
  setMode("tutor");
  wireDrop();
  await checkHealth();
  await checkAuth();
  autoSizeTextarea(el("message"));
}
init();
