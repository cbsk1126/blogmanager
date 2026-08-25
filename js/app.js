import { firebaseConfig } from "./firebase-config.js";

const COLLECTION = "blogManagement";
const GROUP_COLLECTION = "testerGroup";
const PAGE_SIZE = 10;
const fields = ["testerGroupId", "category", "shopName", "area", "address", "part", "food", "visitLastDay", "businessHours", "unavailableDay", "tel", "visitDateTime", "usageStatus", "memo"];
const $ = (selector) => document.querySelector(selector);
const state = { records: [], groups: [], deleteId: null, currentPage: 1, firebase: null, auth: null, databaseStarted: false, databaseUnsubscribes: [] };
const isConfigured = () => firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const normalizeHomepage = (value = "") => {
  const raw = String(value).trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
};
const formatDate = (value, withTime = false) => value ? new Intl.DateTimeFormat("ko-KR", { year:"numeric", month:"2-digit", day:"2-digit", ...(withTime ? {hour:"2-digit", minute:"2-digit"} : {}) }).format(new Date(value)) : "-";
const statusClass = status => ({관심매장:"interest", 사용대기:"waiting", 사용중:"using", 사용완료:"completed"}[status] || "interest");

async function initDatabase(dbModule, db) {
  if (state.databaseStarted) return;
  state.databaseStarted = true;
  const indicator = $("#connectionStatus");
  try {
    state.firebase = { ...dbModule, db };
    indicator.classList.add("online"); indicator.querySelector("span:last-child").textContent = "Firebase 연결됨";
    const recordsUnsubscribe = dbModule.onValue(dbModule.ref(db, COLLECTION), snapshot => {
      const data = snapshot.val() || {};
      state.records = Object.entries(data).map(([idx, row]) => ({ idx, ...row })); normalizePage(); render();
    }, showError);
    const groupsUnsubscribe = dbModule.onValue(dbModule.ref(db, GROUP_COLLECTION), snapshot => {
      const data = snapshot.val() || {};
      state.groups = Object.entries(data).map(([idx, row]) => ({ idx, ...row })).sort((a,b) => (a.testerGroupName || "").localeCompare(b.testerGroupName || "", "ko"));
      renderGroupOptions(); renderGroupList(); render();
    }, showError);
    state.databaseUnsubscribes = [recordsUnsubscribe, groupsUnsubscribe];
  } catch (error) { state.databaseStarted = false; showError(error); indicator.querySelector("span:last-child").textContent = "연결 오류"; }
}

async function persist(record, id) {
  if (state.firebase) {
    const { db, ref, push, set, update } = state.firebase;
    if (id) await update(ref(db, `${COLLECTION}/${id}`), record);
    else await set(push(ref(db, COLLECTION)), record);
  } else throw new Error("Firebase 데이터베이스가 연결되지 않았습니다.");
}

async function removeRecord(id) {
  if (state.firebase) await state.firebase.remove(state.firebase.ref(state.firebase.db, `${COLLECTION}/${id}`));
  else throw new Error("Firebase 데이터베이스가 연결되지 않았습니다.");
}

async function persistGroup(group, id) {
  if (!state.firebase) throw new Error("Firebase 데이터베이스가 연결되지 않았습니다.");
  const { db, ref, push, set, update } = state.firebase;
  if (id) await update(ref(db, `${GROUP_COLLECTION}/${id}`), group);
  else await set(push(ref(db, GROUP_COLLECTION)), group);
}

async function removeGroup(id) {
  if (!state.firebase) throw new Error("Firebase 데이터베이스가 연결되지 않았습니다.");
  if (state.records.some(row => row.testerGroupId === id)) throw new Error("GROUP_IN_USE");
  await state.firebase.remove(state.firebase.ref(state.firebase.db, `${GROUP_COLLECTION}/${id}`));
}

const groupById = id => state.groups.find(group => group.idx === id);
const groupName = id => groupById(id)?.testerGroupName || "미지정";
const groupHomepage = id => normalizeHomepage(groupById(id)?.homepage) || "";
const groupBadge = id => {
  const name = escapeHtml(groupName(id));
  const homepage = groupHomepage(id);
  return homepage
    ? `<a class="group-badge group-badge-link" href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer" title="${name} 홈페이지 열기">${name}</a>`
    : `<span class="group-badge">${name}</span>`;
};

function renderGroupOptions() {
  const options = state.groups.map(group => `<option value="${group.idx}">${escapeHtml(group.testerGroupName)}</option>`).join("");
  const currentFormValue = $("#testerGroupId").value;
  const currentFilterValue = $("#testerGroupFilter").value;
  $("#testerGroupId").innerHTML = `<option value="">체험단을 선택하세요</option>${options}`;
  $("#testerGroupFilter").innerHTML = `<option value="">전체 체험단</option>${options}`;
  if (state.groups.some(group => group.idx === currentFormValue)) $("#testerGroupId").value = currentFormValue;
  if (state.groups.some(group => group.idx === currentFilterValue)) $("#testerGroupFilter").value = currentFilterValue;
}

function renderGroupList() {
  $("#groupCount").textContent = `${state.groups.length}개`;
  $("#groupList").innerHTML = state.groups.length ? state.groups.map(group => {
    const homepage = normalizeHomepage(group.homepage);
    const homepageMarkup = homepage
      ? `<a class="group-homepage" href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(homepage)}</a>`
      : `<span class="group-homepage-empty">홈페이지 미등록</span>`;
    return `<article class="group-item"><div><strong>${escapeHtml(group.testerGroupName)}</strong><span>${escapeHtml(group.testerGroupTel || "연락처 미등록")}</span>${homepageMarkup}</div><div class="row-actions"><button data-group-edit="${group.idx}">수정</button><button class="delete" data-group-delete="${group.idx}">삭제</button></div></article>`;
  }).join("") : `<div class="group-empty">등록된 체험단 분류가 없습니다.</div>`;
}

function filteredRecords() {
  const q = $("#searchInput").value.trim().toLowerCase(), status = $("#statusFilter").value, part = $("#partFilter").value, testerGroupId = $("#testerGroupFilter").value, category = $("#categoryFilter").value, sortOrder = $("#sortOrder").value;
  const rows = state.records.filter(row => {
    const haystack = [row.shopName, groupName(row.testerGroupId), row.category, row.area, row.address, row.food, row.tel, row.memo].join(" ").toLowerCase();
    return (!q || haystack.includes(q)) && (!status || row.usageStatus === status) && (!part || row.part === part) && (!testerGroupId || row.testerGroupId === testerGroupId) && (!category || row.category === category);
  });
  return rows.sort((a,b) => {
    if (sortOrder === "createdDesc") return (b.createdAt || "").localeCompare(a.createdAt || "");
    const aDate = a.visitLastDay || (sortOrder === "deadlineDesc" ? "0000" : "9999");
    const bDate = b.visitLastDay || (sortOrder === "deadlineDesc" ? "0000" : "9999");
    return sortOrder === "deadlineAsc" ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
  });
}

function normalizePage() {
  const totalPages = Math.max(1, Math.ceil(filteredRecords().length / PAGE_SIZE));
  state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
}

function renderPagination(totalRows) {
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);
  if (totalPages <= 1) { $("#pagination").innerHTML = ""; return; }
  const pages = Array.from({length: totalPages}, (_, index) => index + 1);
  $("#pagination").innerHTML = `<button data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? "disabled" : ""}>이전</button>${pages.map(page => `<button data-page="${page}" class="${page === state.currentPage ? "active" : ""}" aria-current="${page === state.currentPage ? "page" : "false"}">${page}</button>`).join("")}<button data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? "disabled" : ""}>다음</button>`;
}

function render() {
  const allRows = filteredRecords(); normalizePage();
  const start = (state.currentPage - 1) * PAGE_SIZE;
  const rows = allRows.slice(start, start + PAGE_SIZE);
  $("#totalCount").textContent = state.records.length;
  $("#waitingCount").textContent = state.records.filter(x => x.usageStatus === "사용대기").length;
  $("#usingCount").textContent = state.records.filter(x => x.usageStatus === "사용중").length;
  $("#completedCount").textContent = state.records.filter(x => x.usageStatus === "사용완료").length;
  $("#resultText").textContent = `총 ${allRows.length}개의 매장 · ${state.currentPage}페이지`; $("#emptyState").hidden = allRows.length !== 0;
  $("#campaignTableBody").innerHTML = rows.map(row => `<tr>
    <td>${groupBadge(row.testerGroupId)}</td><td><span class="category-badge">${escapeHtml(row.category || "미지정")}</span></td><td><div class="shop-cell"><strong>${escapeHtml(row.shopName)}</strong><span>${escapeHtml(row.area || "지역 미입력")}</span><small>${escapeHtml(row.address || "주소 미입력")}</small>${row.memo ? `<small class="memo-preview" title="${escapeHtml(row.memo)}">메모: ${escapeHtml(row.memo)}</small>` : ""}</div></td>
    <td><span class="part-badge">${escapeHtml(row.part)}</span></td><td class="food-cell">${escapeHtml(row.food || "-")}</td>
    <td>${formatDate(row.visitLastDay)}</td><td>${formatDate(row.visitDateTime, true)}</td>
    <td><select class="status-select ${statusClass(row.usageStatus)}" data-status-id="${row.idx}" aria-label="${escapeHtml(row.shopName)} 상태 변경"><option ${row.usageStatus==='관심매장'?'selected':''}>관심매장</option><option ${row.usageStatus==='사용대기'?'selected':''}>사용대기</option><option ${row.usageStatus==='사용중'?'selected':''}>사용중</option><option ${row.usageStatus==='사용완료'?'selected':''}>사용완료</option></select></td>
    <td><div class="row-actions"><button data-edit="${row.idx}">수정</button><button class="delete" data-delete="${row.idx}">삭제</button></div></td></tr>`).join("");
  renderPagination(allRows.length);
}

function openForm(record = null) {
  if (!record && state.groups.length === 0) { toast("먼저 체험단 분류를 등록해 주세요."); openGroupManager(); return; }
  $("#campaignForm").reset(); $("#formError").textContent = ""; $("#recordId").value = record?.idx || "";
  fields.forEach(key => { if (record?.[key] != null) $(`#${key}`).value = record[key]; });
  $("#modalTitle").textContent = record ? "체험단 수정" : "체험단 등록";
  $("#campaignModal").classList.add("open"); $("#campaignModal").setAttribute("aria-hidden", "false"); setTimeout(() => $("#shopName").focus(), 50);
}
function closeForm() { $("#campaignModal").classList.remove("open"); $("#campaignModal").setAttribute("aria-hidden", "true"); }
function openGroupManager() { $("#groupManagerModal").classList.add("open"); $("#groupManagerModal").setAttribute("aria-hidden", "false"); setTimeout(() => $("#testerGroupName").focus(), 50); }
function closeGroupManager() { resetGroupForm(); $("#groupManagerModal").classList.remove("open"); $("#groupManagerModal").setAttribute("aria-hidden", "true"); }
function resetGroupForm() { $("#groupForm").reset(); $("#groupRecordId").value = ""; $("#groupFormError").textContent = ""; $("#saveGroupBtn").textContent = "등록하기"; $("#cancelGroupEditBtn").hidden = true; }
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2200); }
function showError(error) { console.error(error); toast("처리 중 오류가 발생했습니다."); }

$("#openFormBtn").addEventListener("click", () => openForm());
$("#openGroupManagerBtn").addEventListener("click", openGroupManager);
document.querySelectorAll("[data-close-modal]").forEach(el => el.addEventListener("click", closeForm));
document.querySelectorAll("[data-close-group-modal]").forEach(el => el.addEventListener("click", closeGroupManager));
[$("#searchInput"), $("#statusFilter"), $("#partFilter"), $("#testerGroupFilter"), $("#categoryFilter"), $("#sortOrder")].forEach(el => el.addEventListener("input", () => { state.currentPage = 1; render(); }));
$("#resetFilterBtn").addEventListener("click", () => { $("#searchInput").value=""; $("#statusFilter").value=""; $("#partFilter").value=""; $("#testerGroupFilter").value=""; $("#categoryFilter").value=""; $("#sortOrder").value="deadlineDesc"; state.currentPage=1; render(); });
$("#campaignForm").addEventListener("submit", async event => {
  event.preventDefault(); const id=$("#recordId").value; const record={}; fields.forEach(key => record[key]=$(`#${key}`).value.trim());
  if (!record.testerGroupId || !record.category || !record.shopName || !record.area) { $("#formError").textContent="체험단명, 소속, 매장명, 지역명은 필수입니다."; return; }
  record.updatedAt = new Date().toISOString();
  if (!id) record.createdAt = record.updatedAt;
  else record.createdAt = state.records.find(row => row.idx === id)?.createdAt || record.updatedAt;
  const button=$("#saveBtn"); button.disabled=true; button.textContent="저장 중...";
  try { await persist(record,id); closeForm(); toast(id ? "수정되었습니다." : "등록되었습니다."); } catch(e) { showError(e); } finally { button.disabled=false; button.textContent="저장하기"; }
});
$("#pagination").addEventListener("click", event => { const page=Number(event.target.dataset.page); if (!page) return; state.currentPage=page; render(); $(".table-card").scrollIntoView({behavior:"smooth", block:"start"}); });
$("#groupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id=$("#groupRecordId").value, name=$("#testerGroupName").value.trim(), tel=$("#testerGroupTel").value.trim();
  const homepageInput=$("#testerGroupHomepage").value.trim(), homepage=normalizeHomepage(homepageInput);
  if (!name) { $("#groupFormError").textContent="체험단 이름은 필수입니다."; return; }
  if (homepageInput && !homepage) { $("#groupFormError").textContent="홈페이지 주소를 확인해 주세요. http 또는 https 주소만 사용할 수 있습니다."; return; }
  if (state.groups.some(group => group.testerGroupName.toLowerCase() === name.toLowerCase() && group.idx !== id)) { $("#groupFormError").textContent="이미 등록된 체험단 이름입니다."; return; }
  const existing=state.groups.find(group => group.idx===id); const now=new Date().toISOString();
  const button=$("#saveGroupBtn"); button.disabled=true;
  try { await persistGroup({testerGroupName:name, testerGroupTel:tel, homepage, createdAt:existing?.createdAt || now, updatedAt:now}, id); resetGroupForm(); toast(id ? "체험단 분류가 수정되었습니다." : "체험단 분류가 등록되었습니다."); }
  catch(error) { showError(error); } finally { button.disabled=false; }
});
$("#cancelGroupEditBtn").addEventListener("click", resetGroupForm);
$("#groupList").addEventListener("click", async event => {
  const editId=event.target.dataset.groupEdit, deleteId=event.target.dataset.groupDelete;
  if (editId) { const group=state.groups.find(item=>item.idx===editId); $("#groupRecordId").value=group.idx; $("#testerGroupName").value=group.testerGroupName || ""; $("#testerGroupTel").value=group.testerGroupTel || ""; $("#testerGroupHomepage").value=group.homepage || ""; $("#saveGroupBtn").textContent="수정하기"; $("#cancelGroupEditBtn").hidden=false; $("#testerGroupName").focus(); }
  if (deleteId && confirm("이 체험단 분류를 삭제할까요?")) { try { await removeGroup(deleteId); toast("체험단 분류가 삭제되었습니다."); } catch(error) { if (error.message === "GROUP_IN_USE") toast("등록된 매장에서 사용 중인 체험단은 삭제할 수 없습니다."); else showError(error); } }
});
$("#campaignTableBody").addEventListener("click", event => {
  const editId=event.target.dataset.edit, deleteId=event.target.dataset.delete;
  if (editId) openForm(state.records.find(row => row.idx===editId));
  if (deleteId) { state.deleteId=deleteId; $("#deleteDialog").classList.add("open"); $("#deleteDialog").setAttribute("aria-hidden","false"); }
});
$("#campaignTableBody").addEventListener("change", async event => {
  const id=event.target.dataset.statusId; if (!id) return; const { idx, ...row }=state.records.find(x=>x.idx===id);
  try { await persist({...row, usageStatus:event.target.value, updatedAt:new Date().toISOString()},id); toast("상태가 변경되었습니다."); } catch(e) { showError(e); }
});
$("#cancelDeleteBtn").addEventListener("click", () => { $("#deleteDialog").classList.remove("open"); state.deleteId=null; });
$("#confirmDeleteBtn").addEventListener("click", async () => { if (!state.deleteId) return; try { await removeRecord(state.deleteId); toast("삭제되었습니다."); } catch(e) { showError(e); } finally { $("#deleteDialog").classList.remove("open"); state.deleteId=null; } });
document.addEventListener("keydown", e => { if(e.key==="Escape") { closeForm(); closeGroupManager(); $("#deleteDialog").classList.remove("open"); } });

function loginMessage(code) {
  if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (code === "auth/too-many-requests") return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.";
  if (code === "auth/network-request-failed") return "인터넷 연결을 확인해 주세요.";
  return "로그인 중 문제가 발생했습니다.";
}

async function initFirebaseApp() {
  if (!isConfigured()) {
    $("#loginError").textContent = "Firebase 웹 앱 설정값(apiKey, appId 등)을 먼저 입력해야 합니다.";
    $("#loginBtn").disabled = true;
    return;
  }
  try {
    const appModule = await import("https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js");
    const authModule = await import("https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js");
    const dbModule = await import("https://www.gstatic.com/firebasejs/11.2.0/firebase-database.js");
    const app = appModule.initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    const db = dbModule.getDatabase(app);
    state.auth = { ...authModule, auth };

    authModule.onAuthStateChanged(auth, user => {
      const signedIn = Boolean(user);
      $("#loginSection").hidden = signedIn;
      $("#managementSection").hidden = !signedIn;
      if (user) {
        $("#userEmail").textContent = user.email || "관리자";
        $("#loginError").textContent = "";
        initDatabase(dbModule, db);
      } else {
        state.databaseUnsubscribes.forEach(unsubscribe => unsubscribe());
        state.databaseUnsubscribes = [];
        state.records = [];
        state.groups = [];
        state.firebase = null;
        state.databaseStarted = false;
        render();
      }
    });
  } catch (error) {
    console.error(error);
    $("#loginError").textContent = "Firebase 연결 설정을 확인해 주세요.";
  }
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.auth) return;
  const button = $("#loginBtn");
  button.disabled = true; button.textContent = "로그인 중..."; $("#loginError").textContent = "";
  try {
    await state.auth.signInWithEmailAndPassword(state.auth.auth, $("#loginEmail").value.trim(), $("#loginPassword").value);
    $("#loginForm").reset();
  } catch (error) {
    $("#loginError").textContent = loginMessage(error.code);
  } finally {
    button.disabled = false; button.textContent = "로그인";
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  try { await state.auth.signOut(state.auth.auth); toast("로그아웃되었습니다."); }
  catch (error) { showError(error); }
});

initFirebaseApp();
