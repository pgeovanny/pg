/* ====== CONFIG ====== */
const SHEETS_API_BASE = "https://script.google.com/macros/s/SEU_WEB_APP_ID/exec"; // <- cole sua URL
const ENDPOINT_LIST     = `${SHEETS_API_BASE}?action=list`;
const ENDPOINT_LIKE     = `${SHEETS_API_BASE}?action=like`;
const ENDPOINT_FEEDBACK = `${SHEETS_API_BASE}?action=feedback`;

/* ====== STATE ====== */
const $ = (s, el=document)=>el.querySelector(s);
const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
const state = {
  materials: [],
  filtered: [],
  categories: [],
  likesPending: new Set(),
  modal: { open:false, material:null, sentiment:null }
};

document.addEventListener("DOMContentLoaded", async () => {
  $("#year").textContent = new Date().getFullYear();
  bindControls();
  bindModal();
  await loadMaterials();
});

/* ====== LOAD ====== */
async function loadMaterials(){
  setStatus("Carregando materiais…");
  try{
    const res = await fetch(ENDPOINT_LIST, {cache:"no-store"});
    if(!res.ok) throw new Error("Falha ao consultar a planilha.");
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.items || []);
    state.materials = rows
      .filter(r => toBool(r.ativo) !== false)
      .map(normalizeRow);

    state.categories = Array.from(new Set(state.materials.map(m=>m.categoria))).sort();
    fillCategoryFilter(state.categories);
    applyFilters();
    setStatus(`${state.materials.length} materiais carregados.`);
  }catch(err){
    console.error(err);
    setStatus("Não consegui carregar da planilha. Exibindo itens de exemplo.");
    state.materials = demoData().map(normalizeRow);
    state.categories = Array.from(new Set(state.materials.map(m=>m.categoria))).sort();
    fillCategoryFilter(state.categories);
    applyFilters();
  }
}

function normalizeRow(r){
  return {
    id: String(r.id ?? r.ID ?? cryptoUUID()),
    nome: String(r.nome ?? r.material ?? r["nome do material"] ?? "").trim(),
    categoria: String(r.categoria ?? "Outros").trim(),
    amostra: r.amostra || "#",
    compra: r.compra || "#",
    likes: Number(r.likes ?? 0),
  };
}
function cryptoUUID(){
  return (crypto?.randomUUID?.() || ("id-"+Math.random().toString(36).slice(2)));
}

/* ====== FILTER/RENDER ====== */
function bindControls(){
  $("#search").addEventListener("input", applyFilters);
  $("#category").addEventListener("change", applyFilters);
}
function fillCategoryFilter(cats){
  const sel = $("#category");
  sel.innerHTML = `<option value="">Todas as categorias</option>` +
    cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}
function applyFilters(){
  const q = $("#search").value.trim().toLowerCase();
  const cat = $("#category").value;
  state.filtered = state.materials.filter(m=>{
    const okQ = !q || m.nome.toLowerCase().includes(q);
    const okC = !cat || m.categoria === cat;
    return okQ && okC;
  });
  render();
}
function render(){
  const wrapper = $("#lists");
  wrapper.innerHTML = "";
  const byCat = groupBy(state.filtered, m=>m.categoria);
  Object.entries(byCat).sort(([a],[b])=>a.localeCompare(b)).forEach(([cat, items])=>{
    const block = createCategoryBlock(cat, items);
    wrapper.appendChild(block);
  });
}

function createCategoryBlock(cat, items){
  const tpl = $("#tpl-category").content.cloneNode(true);
  $(".cat-name", tpl).textContent = cat;
  $(".cat-count", tpl).textContent = items.length;
  const grid = $(".items", tpl);

  items.forEach(item=>{
    const card = $("#tpl-item").content.cloneNode(true);
    const el = $(".item-card", card);
    el.dataset.id = item.id;
    $(".item-title", card).textContent = item.nome;
    $(".item-meta", card).textContent = `Categoria: ${item.categoria}`;

    const btnSample = $(".btn-sample", card);
    const btnBuy    = $(".btn-buy", card);
    btnSample.href = item.amostra || "#";
    btnBuy.href    = item.compra || "#";

    // Abre modal de feedback quando clicar em "Amostra"
    btnSample.addEventListener("click", () => openFeedbackModal(item, 'sample'));

    const likeBtn = $(".btn.like", card);
    const countEl = $(".like-count", card);
    countEl.textContent = String(item.likes ?? 0);

    const liked = hasLiked(item.id);
    likeBtn.dataset.liked = liked ? "true" : "false";
    likeBtn.setAttribute("aria-pressed", liked ? "true" : "false");
    likeBtn.addEventListener("click", () => handleLike(item, likeBtn, countEl));

    grid.appendChild(card);
  });

  return tpl;
}

/* ====== LIKE ====== */
function likeKey(id){ return `pg_like_${id}`; }
function hasLiked(id){ return localStorage.getItem(likeKey(id)) === "1"; }

async function handleLike(item, btn, countEl){
  if (hasLiked(item.id) || state.likesPending.has(item.id)) return;
  state.likesPending.add(item.id);

  // UI otimista
  bump(btn);
  btn.dataset.liked = "true";
  btn.setAttribute("aria-pressed", "true");
  const prev = Number(countEl.textContent||0);
  countEl.textContent = String(prev + 1);

  try{
    const res = await fetch(ENDPOINT_LIKE, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ action:'like', id: item.id, origem:'like_button', user_id: getUserId() })
    });
    const json = await res.json().catch(()=>({}));
    if (res.ok && typeof json.likes === "number"){
      countEl.textContent = String(json.likes);
      localStorage.setItem(likeKey(item.id), "1");
    } else { throw new Error('fail'); }
  }catch(err){
    // rollback
    btn.dataset.liked = "false";
    btn.setAttribute("aria-pressed", "false");
    countEl.textContent = String(prev);
    alert("Não consegui registrar seu like agora. Tente novamente.");
  }finally{
    state.likesPending.delete(item.id);
  }
}

/* ====== MODAL FEEDBACK (amostra) ====== */
function bindModal(){
  $(".modal-close", $("#modal")).addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e)=>{ if (e.target.id==='modal') closeModal(); });
  $(".m-like", $("#modal")).addEventListener("click", ()=> setSentiment('like'));
  $(".m-dislike", $("#modal")).addEventListener("click", ()=> setSentiment('dislike'));
  $(".m-send", $("#modal")).addEventListener("click", sendFeedback);
}
function openFeedbackModal(item, origem){
  state.modal.material = item;
  state.modal.sentiment = null;
  $("#m-reason").value = "";
  $("#modal").hidden = false;
  $("#modal").dataset.orig = origem || 'sample';
}
function closeModal(){
  $("#modal").hidden = true;
}
function setSentiment(s){
  state.modal.sentiment = s;
  // feedback visual simples
  $(".m-like").classList.toggle("primary", s==='like');
  $(".m-dislike").classList.toggle("primary", s==='dislike');
}
async function sendFeedback(){
  const item = state.modal.material;
  if (!item) return closeModal();
  const sentimento = state.modal.sentiment || 'like'; // padrão
  const motivo = $("#m-reason").value.trim();
  const origem = $("#modal").dataset.orig || 'sample';

  try{
    const res = await fetch(ENDPOINT_FEEDBACK, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        action:'feedback', id: item.id, sentimento, motivo, origem,
        user_id: getUserId()
      })
    });
    const json = await res.json().catch(()=>({}));
    if (res.ok){
      // Se for like pelo modal, refletir contagem
      if (sentimento === 'like'){
        const countEl = $(`.item-card[data-id="${item.id}"] .like-count`);
        if (countEl) countEl.textContent = String(json.likes ?? (Number(countEl.textContent||0)+1));
        localStorage.setItem(likeKey(item.id), "1");
        const btn = $(`.item-card[data-id="${item.id}"] .btn.like`);
        if (btn){ btn.dataset.liked="true"; btn.setAttribute("aria-pressed","true"); }
      }
      closeModal();
    } else {
      throw new Error('Falha ao enviar feedback');
    }
  }catch(err){
    alert("Não consegui enviar seu feedback agora. Tente novamente.");
  }
}

/* ====== UTILS ====== */
function setStatus(msg){ $("#status").textContent = msg || ""; }
function groupBy(arr, fn){
  return arr.reduce((acc, it)=>{ const k = fn(it); (acc[k] ||= []).push(it); return acc; }, {});
}
function toBool(v){
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v||"").trim().toLowerCase();
  return !["0","false","nao","não","n","off","no"].includes(s);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function demoData(){
  return [
    {id:"ajaa-teoria", nome:"AJAA – Teoria Completa", categoria:"TJ-GO", amostra:"#", compra:"#", likes:42, ativo:true},
    {id:"ajaa-questoes", nome:"AJAA – 500 Questões CESPE/Verbena", categoria:"TJ-GO", amostra:"#", compra:"#", likes:35, ativo:true},
    {id:"tjsp-interna", nome:"Legislação Interna TJ-SP 2025 (com mapas)", categoria:"TJ-SP", amostra:"#", compra:"#", likes:57, ativo:true},
    {id:"manual-aprovado", nome:"Manual do Aprovado (Estratégias)", categoria:"Método", amostra:"#", compra:"#", likes:64, ativo:true},
  ];
}
function bump(btn){ btn.dataset.bump = "1"; setTimeout(()=>{ btn.dataset.bump = "0"; }, 380); }
function getUserId(){
  const key = 'pg_user_id';
  let id = localStorage.getItem(key);
  if (!id){ id = cryptoUUID(); localStorage.setItem(key, id); }
  return id;
}
