/* ====== CONFIG ====== */
/** PUBLICAR seu Apps Script como Web App e colar as URLs abaixo.
 *  Sugestão: usar a MESMA URL e trocar por ação via query: ?action=list / POST action=like
 */
const SHEETS_API_BASE = "https://script.google.com/macros/s/AKfycbxaA9y-kGcS3Sb0JtxktH92v-Y3id9vJbXggDoC20tZ9QFdCtcx0f0GOb5Hgzm2-0aa/exec"; // TODO
const ENDPOINT_LIST = `${SHEETS_API_BASE}?action=list`;
const ENDPOINT_LIKE = `${SHEETS_API_BASE}?action=like`;

/* ====== BOOT ====== */
const $ = (sel, el=document)=>el.querySelector(sel);
const $$ = (sel, el=document)=>Array.from(el.querySelectorAll(sel));
const state = {
  materials: [],
  filtered: [],
  categories: [],
  likesPending: new Set()
};

document.addEventListener("DOMContentLoaded", async () => {
  $("#year").textContent = new Date().getFullYear();
  bindControls();
  await loadMaterials();
});

/* ====== LOAD MATERIALS ====== */
async function loadMaterials(){
  setStatus("Carregando materiais…");
  try{
    const res = await fetch(ENDPOINT_LIST, {cache:"no-store"});
    if(!res.ok) throw new Error("Falha ao consultar a planilha.");
    const data = await res.json();

    // Espera-se um array de objetos com:
    // { id, nome, categoria, amostra, compra, likes, ativo }
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
    // Fallback local – apague quando estiver integrado ao Sheets
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
    categoria: String(r.categoria ?? r["categoria"] ?? "Outros").trim(),
    amostra: r.amostra || r.sample || "#",
    compra: r.compra || r.buy || "#",
    likes: Number(r.likes ?? r.Likes ?? 0),
  };
}
function cryptoUUID(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-"+Math.random().toString(36).slice(2);
}

/* ====== FILTERING & RENDER ====== */
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
    $('[data-kind="sample"]', card).href = item.amostra || "#";
    $('[data-kind="buy"]', card).href = item.compra || "#";
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

/* ====== LIKES ====== */
function hasLiked(id){
  return localStorage.getItem(likeKey(id)) === "1";
}
function likeKey(id){ return `pg_like_${id}`; }

async function handleLike(item, btn, countEl){
  if (hasLiked(item.id) || state.likesPending.has(item.id)) return;
  state.likesPending.add(item.id);

  // otimista no UI
  bump(btn);
  btn.dataset.liked = "true";
  btn.setAttribute("aria-pressed", "true");
  const prev = Number(countEl.textContent||0);
  countEl.textContent = String(prev + 1);

  try{
    const res = await fetch(ENDPOINT_LIKE, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ id: item.id })
    });
    if(!res.ok) throw new Error("Falha ao registrar like");
    const json = await res.json();
    // opcionalmente respeitar contagem do servidor
    if (typeof json.likes === "number"){
      countEl.textContent = String(json.likes);
    }
    localStorage.setItem(likeKey(item.id), "1");
  }catch(err){
    console.error(err);
    // rollback
    btn.dataset.liked = "false";
    btn.setAttribute("aria-pressed", "false");
    countEl.textContent = String(prev);
    alert("Não consegui registrar seu like agora. Tente novamente em instantes.");
  }finally{
    state.likesPending.delete(item.id);
  }
}
function bump(btn){
  btn.dataset.bump = "1";
  setTimeout(()=>{ btn.dataset.bump = "0"; }, 380);
}

/* ====== UTILS ====== */
function setStatus(msg){ $("#status").textContent = msg || ""; }
function groupBy(arr, fn){
  return arr.reduce((acc, it)=>{
    const k = fn(it); (acc[k] ||= []).push(it); return acc;
  }, {});
}
function toBool(v){
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v||"").trim().toLowerCase();
  return !["0","false","nao","não","n","off","no"].includes(s);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}
function demoData(){
  return [
    {id:"ajaa-teoria", nome:"AJAA – Teoria Completa", categoria:"TJ-GO", amostra:"#", compra:"#", likes:42, ativo:true},
    {id:"ajaa-questoes", nome:"AJAA – 500 Questões CESPE/Verbena", categoria:"TJ-GO", amostra:"#", compra:"#", likes:35, ativo:true},
    {id:"tjsp-interna", nome:"Legislação Interna TJ-SP 2025 (com mapas)", categoria:"TJ-SP", amostra:"#", compra:"#", likes:57, ativo:true},
    {id:"manual-aprovado", nome:"Manual do Aprovado (Estratégias)", categoria:"Método", amostra:"#", compra:"#", likes:64, ativo:true},
  ];
}
