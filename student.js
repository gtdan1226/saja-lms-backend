/* ── student.js ────────────────────────────────────────────── */
const API = (window.CARNIVAL_LION_API_URL || location.origin).replace(/\/$/, "");
let state = null;
let activeCourseId = null;
let activeChapterId = null;
let activeCourseTab = "content";
let boardPosts = {};
let boardLoadId = 0;
let wmTimer = null;

// ── Auth check ──────────────────────────────────────────────
let _isPreview = false;

async function boot() {
  const previewUserId = new URLSearchParams(location.search).get("preview");
  try {
    const me = await fetch(API + "/api/auth/me", { credentials: "include" });
    if (me.status === 401) { location.href = "/login.html"; return; }
    const meData = await me.json();
    if (meData.role === "admin") {
      if (previewUserId) {
        await loadPreviewState(previewUserId);
      } else {
        location.href = "/admin.html";
      }
      return;
    }
  } catch {
    showError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    return;
  }
  await loadState();
}

async function loadPreviewState(userId) {
  try {
    const res = await api(`/api/admin/students/${userId}/preview`);
    if (!res.ok) { showError("학생 데이터를 불러올 수 없습니다."); return; }
    state = await res.json();
    _isPreview = true;
    showPreviewBanner();
    render();
  } catch {
    showError("미리보기를 불러오지 못했습니다.");
  }
}

function showPreviewBanner() {
  const u = state.user;
  const banner = document.createElement("div");
  banner.id = "previewBanner";
  banner.innerHTML = `
    <span>관리자 미리보기: <strong>${u?.name || u?.email || "학생"}</strong> (${u?.email || ""})</span>
    <button onclick="location.href='/admin.html'">관리자 페이지로 돌아가기</button>
  `;
  document.body.prepend(banner);
}

async function loadState() {
  try {
    const res = await api("/api/state");
    if (res.status === 401) { location.href = "/login.html"; return; }
    state = await res.json();
    render();
  } catch {
    showError("상태를 불러오지 못했습니다.");
  }
}

async function api(path, options = {}) {
  return fetch(API + path, { credentials: "include", ...options });
}

// ── Render ──────────────────────────────────────────────────
function render() {
  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("appShell").classList.remove("is-hidden");
  renderUser();
  renderCourseNav();
  const gated = renderGate();
  if (gated) {
    ["workspaceHeader","courseTabs","videoSection","chapterSection","submitSection",
     "submissionsSection","boardSection","qaSection","mypageSection","emptyState"]
      .forEach((id) => { document.getElementById(id).style.display = "none"; });
    return;
  }
  if (activeCourseId) renderCourse(activeCourseId);
  else if (state.courses?.length) selectCourse(state.courses[0].id);
  else document.getElementById("emptyState").style.display = "";
}

function renderUser() {
  const u = state.user;
  if (!u) return;
  document.getElementById("userName").textContent = u.name || u.email;
  document.getElementById("userId").textContent = u.memberId || "";
  document.getElementById("userAvatar").textContent = (u.name || u.email || "?")[0].toUpperCase();
}

function renderCourseNav() {
  const nav = document.getElementById("courseNav");
  const courses = state.courses || [];
  if (!courses.length) { nav.innerHTML = "<p style='padding:12px 20px;color:var(--muted);font-size:13px'>강의 없음</p>"; return; }
  nav.innerHTML = courses.map((c) => `
    <button class="nav-item ${activeCourseId === c.id ? "is-active" : ""}" data-course="${c.id}">
      <span class="nav-room">${c.room}</span>
      <span class="nav-title">${c.title}</span>
    </button>
  `).join("");
  nav.querySelectorAll(".nav-item").forEach((btn) =>
    btn.addEventListener("click", () => selectCourse(btn.dataset.course)),
  );
}

function renderGate() {
  const enrollment = state.enrollment;
  const gateBand = document.getElementById("gateBand");
  if (!enrollment || enrollment.status === "refunded") {
    showGate("수강권 없음", "수강 신청 후 이용할 수 있습니다.", null);
    return true;
  }
  if (!enrollment.emailVerified) {
    showGate("이메일 인증 필요", "초대 링크를 통해 이메일을 인증해 주세요.", null);
    return true;
  }
  if (!enrollment.contractSigned) {
    showGate("계약서 서명 필요", "강의 시청 전 수강 계약서에 서명이 필요합니다.", "계약서 서명");
    if (!_isPreview) setTimeout(openContractModal, 150);
    return true;
  }
  gateBand.classList.add("is-hidden");
  return false;
}

function showGate(title, desc, btnLabel) {
  document.getElementById("gateBand").classList.remove("is-hidden");
  document.getElementById("gateTitle").textContent = title;
  document.getElementById("gateDesc").textContent = desc;
  const btn = document.getElementById("gateActionBtn");
  if (btnLabel) { btn.textContent = btnLabel; btn.style.display = ""; }
  else btn.style.display = "none";
}

function selectCourse(courseId) {
  activeCourseId = courseId;
  activeCourseTab = "content";
  document.getElementById("mypageSection").style.display = "none";
  document.getElementById("boardSection").style.display = "none";
  document.getElementById("qaSection").style.display = "none";
  renderCourseNav();
  renderCourse(courseId);
}

function renderCourse(courseId) {
  const course = (state.courses || []).find((c) => c.id === courseId);
  if (!course) return;
  document.getElementById("workspaceHeader").style.display = "";
  document.getElementById("roomPill").textContent = course.room;
  document.getElementById("courseSubtitle").textContent = course.subtitle || "";
  document.getElementById("courseTitle").textContent = course.title;

  // 탭 스트립 표시 + 활성 탭 스타일
  const tabs = document.getElementById("courseTabs");
  tabs.style.display = "";
  ["tabContent","tabBoard","tabQa"].forEach((id) => {
    const el = document.getElementById(id);
    const active = id === { content:"tabContent", board:"tabBoard", qa:"tabQa" }[activeCourseTab];
    el.style.borderBottom = active ? "2px solid var(--teal)" : "2px solid transparent";
    el.style.color = active ? "var(--teal)" : "var(--muted)";
    el.style.fontWeight = active ? "600" : "400";
  });

  const hideContent = () => {
    ["videoSection","chapterSection","submitSection","submissionsSection","emptyState"]
      .forEach((id) => { document.getElementById(id).style.display = "none"; });
  };

  if (activeCourseTab === "content") {
    document.getElementById("boardSection").style.display = "none";
    document.getElementById("qaSection").style.display = "none";
    renderVideoSection(course);
    renderChapters(course);
    renderSubmitSection(course);
    renderSubmissions();
  } else if (activeCourseTab === "board") {
    hideContent();
    document.getElementById("qaSection").style.display = "none";
    renderBoard(courseId);
  } else if (activeCourseTab === "qa") {
    hideContent();
    document.getElementById("boardSection").style.display = "none";
    renderQa(courseId);
  }
}

function renderVideoSection(course) {
  const unlocked = isUnlocked();
  const section = document.getElementById("videoSection");
  section.style.display = "";
  const activeSession = state.drm?.activeSession;
  const isForThisCourse = activeSession?.courseId === course.id;
  const video = document.getElementById("courseVideo");

  if (isForThisCourse && activeChapterId === activeSession.chapterId) {
    document.getElementById("videoPlaceholder").style.display = "none";
    document.getElementById("drmBar").style.display = "";
    const ch = course.chapters.find((c) => c.id === activeSession.chapterId);
    document.getElementById("drmLabel").textContent = `${activeSession.chapterLabel} · ${ch?.title || ""} 재생 중`;
    // presigned R2 URL을 video 태그에 연결
    const manifestUrl = activeSession.manifestUrl;
    if (manifestUrl && video.dataset.loadedUrl !== manifestUrl) {
      video.src = manifestUrl;
      video.dataset.loadedUrl = manifestUrl;
      video.style.display = "block";
      video.play().catch(() => {});
    } else if (manifestUrl) {
      video.style.display = "block";
    } else {
      video.style.display = "none";
      document.getElementById("videoPlaceholder").style.display = "";
      document.getElementById("videoMeta").textContent = "영상 파일이 아직 업로드되지 않았습니다.";
    }
    startWatermark();
  } else {
    // 세션 없음 — 플레이스홀더 표시, 비디오 숨김
    video.pause();
    video.style.display = "none";
    video.src = "";
    delete video.dataset.loadedUrl;
    document.getElementById("videoPlaceholder").style.display = "";
    document.getElementById("drmBar").style.display = "none";
    document.getElementById("videoMeta").textContent = activeChapterId
      ? `선택: ${course.chapters.find((c) => c.id === activeChapterId)?.label || ""}`
      : "챕터를 선택해 재생을 시작하세요.";
    stopWatermark();
  }
  document.getElementById("playBtn").disabled = !unlocked || !activeChapterId;
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("chapterSection").style.display = "";
  document.getElementById("submitSection").style.display = "";
  document.getElementById("submissionsSection").style.display = "";
}

function renderChapters(course) {
  const list = document.getElementById("chapterList");
  const progress = state.progress || {};
  list.innerHTML = course.chapters.map((ch) => {
    const pct = progress[`${state.user?.id}:${course.id}:${ch.id}`] || 0;
    const done = pct >= 100;
    const active = activeChapterId === ch.id;
    return `
      <li class="chapter-item ${active ? "is-active" : ""} ${done ? "is-done" : ""}" data-chid="${ch.id}">
        <div class="chapter-meta">
          <span class="chapter-label">${ch.label}</span>
          <span class="chapter-title">${ch.title}</span>
        </div>
        <div class="chapter-right">
          <span class="chapter-dur">${ch.duration}</span>
          <span class="chapter-status">${done ? "✓" : pct > 0 ? `${pct}%` : ""}</span>
        </div>
      </li>`;
  }).join("");
  list.querySelectorAll(".chapter-item").forEach((li) => {
    li.addEventListener("click", () => {
      activeChapterId = li.dataset.chid;
      renderCourse(activeCourseId);
    });
  });
}

function renderSubmitSection(course) {
  document.getElementById("activeCourseForSubmit").textContent = course.room;
  const sel = document.getElementById("submitChapterSel");
  sel.innerHTML = course.chapters.map((ch) => `<option value="${ch.id}">${ch.label} · ${ch.title}</option>`).join("");
}

function renderSubmissions() {
  const list = document.getElementById("submissionsList");
  const subs = state.submissions || [];
  if (!subs.length) {
    list.innerHTML = "<li style='color:var(--muted);font-size:13px;padding:12px 0'>제출 내역이 없습니다.</li>";
    return;
  }
  list.innerHTML = subs.map((s) => `
    <li class="submission-item">
      <div class="sub-header">
        <span class="pill">${s.chapterLabel}</span>
        <span class="sub-status ${s.status === "feedback_sent" ? "done" : ""}">${s.status === "feedback_sent" ? "피드백 완료" : "피드백 대기"}</span>
        <span class="sub-date">${s.createdAt}</span>
      </div>
      <p class="sub-text">${escHtml(s.text)}</p>
      ${s.feedback ? `<div class="feedback-block"><strong>피드백</strong><p>${escHtml(s.feedback)}</p></div>` : ""}
    </li>`).join("");
}

// ── Helpers ─────────────────────────────────────────────────
function isUnlocked() {
  const e = state?.enrollment;
  return !!(e && e.emailVerified && e.contractSigned && e.status === "active");
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showError(msg) {
  document.getElementById("loadingScreen").innerHTML = `
    <div class="loader-inner">
      <p style="color:var(--rose,#b94d58);font-size:15px">${msg}</p>
      <button onclick="location.reload()" style="margin-top:16px;padding:8px 20px;border:1px solid #ccc;border-radius:8px;cursor:pointer">다시 시도</button>
    </div>`;
}

// ── Watermark ───────────────────────────────────────────────
function startWatermark() {
  const wm = document.getElementById("watermark");
  const u = state?.user;
  if (!u) return;
  wm.textContent = `${u.name} · ${u.email}`;
  wm.style.display = "";
  stopWatermark();
  function reposition() {
    const p = document.getElementById("videoFrame");
    if (!p) return;
    const maxX = Math.max(0, p.offsetWidth - wm.offsetWidth - 20);
    const maxY = Math.max(0, p.offsetHeight - wm.offsetHeight - 20);
    wm.style.left = Math.random() * maxX + "px";
    wm.style.top = Math.random() * maxY + "px";
  }
  reposition();
  wmTimer = setInterval(reposition, 2600);
}

function stopWatermark() {
  clearInterval(wmTimer);
  const wm = document.getElementById("watermark");
  wm.style.display = "none";
}

// ── Events ──────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (_isPreview) { location.href = "/admin.html"; return; }
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login.html";
});

document.getElementById("mypageBtn").addEventListener("click", () => {
  if (_isPreview) return;
  showMypage();
});

// ── Mypage ──────────────────────────────────────────────────
function showMypage() {
  ["workspaceHeader","courseTabs","videoSection","chapterSection","submitSection",
   "submissionsSection","emptyState","boardSection","qaSection"]
    .forEach((id) => { document.getElementById(id).style.display = "none"; });
  document.getElementById("mypageSection").style.display = "block";
  activeCourseId = null;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("is-active"));
  renderMypage();
}

function daysUntil(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function renderMypage() {
  const drm = state.drm || {};
  const devices = drm.devices || [];
  const currentDeviceId = drm.currentDeviceId || null;
  const removalsThisMonth = drm.deviceRemovalsThisMonth || 0;
  const limit = drm.deviceRemovalLimit || 2;
  const remaining = Math.max(0, limit - removalsThisMonth);
  const u = state.user || {};
  const courses = state.courses || [];
  const expiresAt = state.accessExpiresAt;
  const daysLeft = daysUntil(expiresAt);

  const deviceRows = devices.length ? devices.map((d) => {
    const isCurrent = d.id === currentDeviceId;
    const dateStr = d.registeredAt ? new Date(d.registeredAt).toLocaleDateString("ko-KR") : "-";
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-size:14px;font-weight:600">${d.label}</span>
        ${isCurrent ? `<span style="margin-left:8px;font-size:11px;background:var(--teal);color:#fff;padding:2px 7px;border-radius:10px">현재 기기</span>` : ""}
        <div style="font-size:12px;color:var(--muted);margin-top:3px">등록일: ${dateStr}</div>
      </div>
      <button
        style="font-size:12px;padding:5px 12px;border:1px solid #e53e3e;border-radius:6px;background:transparent;color:#e53e3e;cursor:pointer;${remaining === 0 ? "opacity:.4;cursor:not-allowed" : ""}"
        onclick="removeDevice('${d.id}')"
        ${remaining === 0 ? "disabled" : ""}>삭제</button>
    </div>`;
  }).join("") : `<p style="color:var(--muted);font-size:13px;padding:12px 0">등록된 기기가 없습니다.</p>`;

  const courseRows = courses.length ? courses.map((c) => {
    const urgentColor = daysLeft !== null && daysLeft <= 30 ? "#e53e3e" : "var(--muted)";
    const daysLabel = daysLeft === null ? "-"
      : daysLeft <= 0 ? "만료됨"
      : `${daysLeft}일 남음 (${new Date(expiresAt).toLocaleDateString("ko-KR")} 까지)`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--border)">
      <div>
        <span style="font-size:13px;font-weight:600">${c.room}</span>
        <span style="font-size:13px;color:var(--muted);margin-left:8px">${c.title}</span>
      </div>
      <span style="font-size:12px;color:${urgentColor};font-weight:${daysLeft !== null && daysLeft <= 30 ? "600" : "400"}">${daysLabel}</span>
    </div>`;
  }).join("") : `<p style="color:var(--muted);font-size:13px;padding:12px 0">등록된 강의가 없습니다.</p>`;

  document.getElementById("mypageContent").innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">기본 정보</h3>
      <div style="font-size:13px;line-height:2;color:var(--text)">
        <div><span style="color:var(--muted);display:inline-block;width:60px">이름</span>${u.name || "-"}</div>
        <div><span style="color:var(--muted);display:inline-block;width:60px">이메일</span>${u.email || "-"}</div>
        <div><span style="color:var(--muted);display:inline-block;width:60px">회원번호</span>${u.memberId || "-"}</div>
      </div>
    </div>

    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:4px">강의별 열람 기간</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">모든 강의실은 동일한 수강 기간이 적용됩니다.</p>
      ${courseRows}
    </div>

    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">비밀번호 변경</h3>
      <div id="pwChangeMsg" style="display:none;font-size:13px;padding:10px 12px;border-radius:8px;margin-bottom:12px"></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <input type="password" id="pwCurrent" placeholder="현재 비밀번호" style="padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
        <input type="password" id="pwNew" placeholder="새 비밀번호 (8자 이상)" style="padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
        <input type="password" id="pwNewConfirm" placeholder="새 비밀번호 확인" style="padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
        <button onclick="changePassword()" style="padding:10px;background:var(--teal);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">변경</button>
      </div>
    </div>

    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="font-size:14px;font-weight:700">등록된 기기</h3>
        <span style="font-size:12px;${remaining === 0 ? "color:#e53e3e;font-weight:600" : "color:var(--muted)"}">이번 달 삭제 가능: ${remaining}/${limit}회</span>
      </div>
      ${deviceRows}
      <div style="margin-top:14px;padding:12px 14px;background:var(--bg);border-radius:8px;font-size:12px;color:var(--muted);line-height:1.8">
        <strong style="color:var(--text);display:block;margin-bottom:4px">기기 등록 기준 안내</strong>
        기기는 <strong style="color:var(--text)">처음 로그인한 브라우저</strong>를 기준으로 자동 등록됩니다. 최대 ${limit}대까지 사용할 수 있습니다.<br>
        아래 경우에는 새 기기로 등록됩니다:<br>
        · 크롬, 사파리, 엣지 등 <strong style="color:var(--text)">다른 브라우저</strong> 사용<br>
        · PC와 <strong style="color:var(--text)">스마트폰</strong>을 함께 사용<br>
        · <strong style="color:var(--text)">브라우저 데이터(캐시·쿠키)</strong>를 직접 삭제한 경우<br>
        · <strong style="color:var(--text)">시크릿 모드</strong> 사용 후 창을 닫은 경우<br><br>
        기기 슬롯이 부족할 경우 기기를 삭제하면 해당 브라우저에서 자동 로그아웃됩니다.<br>
        기기 삭제는 이번 달 ${remaining}회 더 가능합니다 (월 최대 ${limit}회).
      </div>
    </div>`;
}

async function changePassword() {
  const current = document.getElementById("pwCurrent")?.value || "";
  const newPw = document.getElementById("pwNew")?.value || "";
  const newPw2 = document.getElementById("pwNewConfirm")?.value || "";
  const msgEl = document.getElementById("pwChangeMsg");
  const showMsg = (msg, ok) => {
    msgEl.textContent = msg;
    msgEl.style.display = "block";
    msgEl.style.background = ok ? "#f0fdf4" : "#fef2f2";
    msgEl.style.color = ok ? "#15803d" : "#b91c1c";
    msgEl.style.border = `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`;
  };
  if (!current || !newPw || !newPw2) { showMsg("모든 항목을 입력해 주세요.", false); return; }
  if (newPw.length < 8) { showMsg("새 비밀번호는 8자 이상이어야 합니다.", false); return; }
  if (newPw !== newPw2) { showMsg("새 비밀번호가 일치하지 않습니다.", false); return; }
  const res = await api("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
  });
  const data = await res.json();
  if (!res.ok) { showMsg(data.error || "변경 실패", false); return; }
  state = data;
  document.getElementById("pwCurrent").value = "";
  document.getElementById("pwNew").value = "";
  document.getElementById("pwNewConfirm").value = "";
  showMsg("비밀번호가 변경되었습니다.", true);
}

async function removeDevice(deviceId) {
  const devices = state.drm?.devices || [];
  const device = devices.find((d) => d.id === deviceId);
  const isCurrent = deviceId === state.drm?.currentDeviceId;
  const label = device?.label || "이 기기";
  const msg = isCurrent
    ? `${label}(현재 기기)을 삭제하면 로그아웃됩니다. 계속하시겠습니까?`
    : `${label}을 삭제하시겠습니까?`;
  if (!confirm(msg)) return;
  const res = await api("/api/drm/devices", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "삭제 실패"); return; }
  if (data.loggedOut) { location.href = "/login.html"; return; }
  state = data.state;
  renderMypage();
}

document.getElementById("playBtn").addEventListener("click", async () => {
  if (_isPreview) { alert("미리보기 모드에서는 재생할 수 없습니다."); return; }
  if (!isUnlocked()) { openContractModal(); return; }
  if (!activeChapterId) return;
  const btn = document.getElementById("playBtn");
  btn.disabled = true;
  btn.textContent = "재생 준비 중...";
  try {
    const res = await api("/api/playback/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: activeCourseId, chapterId: activeChapterId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "재생 세션 생성 실패"); return; }
    state = data;
    render();
  } catch { alert("재생 요청 중 오류가 발생했습니다."); }
  finally { btn.disabled = false; btn.textContent = "▶ 재생 시작"; }
});

document.getElementById("endSessionBtn").addEventListener("click", async () => {
  const video = document.getElementById("courseVideo");
  video.pause();
  video.src = "";
  delete video.dataset.loadedUrl;
  const res = await api("/api/drm/sessions/revoke", { method: "POST" });
  if (res.ok) { state = await res.json(); render(); }
});

document.getElementById("gateActionBtn").addEventListener("click", () => {
  const enrollment = state?.enrollment;
  if (enrollment && enrollment.emailVerified && !enrollment.contractSigned) openContractModal();
});

document.getElementById("submitBtn").addEventListener("click", async () => {
  const chapterId = document.getElementById("submitChapterSel").value;
  const text = document.getElementById("submitText").value.trim();
  const fileName = document.getElementById("submitFileName").value.trim();
  const status = document.getElementById("submitStatus");
  if (!text) { status.textContent = "내용을 입력해 주세요."; status.className = "submit-status error"; return; }
  const res = await api("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courseId: activeCourseId, chapterId, text, fileName }),
  });
  const data = await res.json();
  if (!res.ok) { status.textContent = data.error || "제출 실패"; status.className = "submit-status error"; return; }
  state = data;
  document.getElementById("submitText").value = "";
  document.getElementById("submitFileName").value = "";
  status.textContent = "제출 완료!";
  status.className = "submit-status success";
  renderSubmissions();
  setTimeout(() => { status.textContent = ""; }, 3000);
});

// ── Contract modal ──────────────────────────────────────────
function openContractModal() {
  const modal = document.getElementById("contractModal");
  if (state.user) {
    document.getElementById("contractEmail").value = state.enrollment?.buyerEmail || "";
    document.getElementById("contractName").value = state.user?.name || "";
  }
  document.getElementById("contractError").textContent = "";
  modal.showModal();
}

document.getElementById("contractClose").addEventListener("click", () => {
  document.getElementById("contractModal").close();
});

document.getElementById("contractSign").addEventListener("click", async () => {
  const name = document.getElementById("contractName").value.trim();
  const email = document.getElementById("contractEmail").value.trim();
  const confirmed = document.getElementById("contractConfirm").checked;
  const errEl = document.getElementById("contractError");
  if (!name || !email || !confirmed) { errEl.textContent = "모든 항목을 입력하고 동의해 주세요."; return; }
  const res = await api("/api/contracts/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, confirmed }),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error || "서명 실패"; return; }
  state = data;
  document.getElementById("contractModal").close();
  render();
});

// ── Tab listeners ───────────────────────────────────────────
document.getElementById("tabContent").addEventListener("click", () => {
  if (activeCourseTab === "content" || !activeCourseId) return;
  activeCourseTab = "content";
  renderCourse(activeCourseId);
});
document.getElementById("tabBoard").addEventListener("click", () => {
  if (activeCourseTab === "board" || !activeCourseId) return;
  activeCourseTab = "board";
  renderCourse(activeCourseId);
});
document.getElementById("tabQa").addEventListener("click", () => {
  if (activeCourseTab === "qa" || !activeCourseId) return;
  activeCourseTab = "qa";
  renderCourse(activeCourseId);
});

// ── Board ───────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "방금";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

async function renderBoard(courseId) {
  const section = document.getElementById("boardSection");
  section.style.display = "block";
  const thisId = ++boardLoadId;
  section.innerHTML = `<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">게시판 불러오는 중...</div>`;
  try {
    const res = await api(`/api/courses/${courseId}/board`);
    if (boardLoadId !== thisId) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "로드 실패");
    boardPosts[courseId] = data.posts || [];
  } catch (e) {
    if (boardLoadId !== thisId) return;
    section.innerHTML = `<div style="padding:32px;color:#e53e3e;font-size:13px">게시판을 불러오지 못했습니다.</div>`;
    return;
  }
  section.innerHTML = renderBoardHtml(courseId, boardPosts[courseId]);
}

function renderBoardHtml(courseId, posts) {
  const myId = state.user?.id;
  const compose = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">
      <textarea id="boardNewPostText" placeholder="강의에 대한 질문이나 의견을 자유롭게 남겨보세요."
        style="width:100%;resize:vertical;border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;
               font-size:13px;background:var(--bg);color:var(--text);min-height:80px;outline:none;
               box-sizing:border-box;font-family:inherit"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button onclick="createPost('${courseId}')"
          style="padding:8px 18px;background:var(--teal);color:#fff;border:none;border-radius:8px;
                 font-size:13px;font-weight:600;cursor:pointer">게시하기</button>
      </div>
      <div id="boardPostStatus" style="font-size:12px;color:var(--muted);margin-top:4px;min-height:16px"></div>
    </div>`;

  const postsHtml = posts.length ? posts.map((post) => {
    const isMine = post.userId === myId;
    const cmts = post.comments || [];
    const cmtsHtml = cmts.map((c) => `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;
                  padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <span style="font-weight:600;font-size:13px">${escHtml(c.nickname)}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:6px">${fmtDate(c.createdAt)}</span>
          <p style="font-size:13px;margin-top:3px;white-space:pre-wrap;word-break:break-word">${escHtml(c.content)}</p>
        </div>
        ${c.userId === myId ? `<button onclick="deleteComment('${courseId}','${post.id}','${c.id}')"
          style="margin-left:8px;flex-shrink:0;font-size:11px;padding:3px 8px;border:1px solid #e53e3e;
                 border-radius:5px;background:transparent;color:#e53e3e;cursor:pointer">삭제</button>` : ""}
      </div>`).join("");

    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;
                         padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div>
          <span style="font-weight:700;font-size:14px">${escHtml(post.nickname)}</span>
          <span style="font-size:12px;color:var(--muted);margin-left:8px">${fmtDate(post.createdAt)}</span>
        </div>
        ${isMine ? `<button onclick="deletePost('${courseId}','${post.id}')"
          style="font-size:12px;padding:4px 10px;border:1px solid #e53e3e;border-radius:6px;
                 background:transparent;color:#e53e3e;cursor:pointer">삭제</button>` : ""}
      </div>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word">${escHtml(post.content)}</p>
      <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:12px">
        ${cmtsHtml}
        <div style="display:flex;gap:8px;margin-top:${cmts.length ? "10px" : "0"}">
          <input type="text" id="cmt-${post.id}" placeholder="댓글 입력..."
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();addComment('${courseId}','${post.id}')}"
            style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;
                   background:var(--bg);color:var(--text);outline:none">
          <button onclick="addComment('${courseId}','${post.id}')"
            style="padding:8px 14px;background:var(--teal);color:#fff;border:none;border-radius:8px;
                   font-size:13px;cursor:pointer;white-space:nowrap">등록</button>
        </div>
      </div>
    </div>`;
  }).join("") : `<p style="padding:40px 0;text-align:center;color:var(--muted);font-size:13px">아직 게시글이 없습니다. 첫 번째 글을 남겨보세요!</p>`;

  return `<div style="padding:24px;max-width:720px">${compose}${postsHtml}</div>`;
}

async function createPost(courseId) {
  const textarea = document.getElementById("boardNewPostText");
  const content = (textarea?.value || "").trim();
  const statusEl = document.getElementById("boardPostStatus");
  if (!content) { if (statusEl) statusEl.textContent = "내용을 입력해 주세요."; return; }
  const res = await api(`/api/courses/${courseId}/board/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!res.ok) { if (statusEl) statusEl.textContent = data.error || "게시 실패"; return; }
  if (!boardPosts[courseId]) boardPosts[courseId] = [];
  boardPosts[courseId].unshift(data.post);
  if (textarea) textarea.value = "";
  document.getElementById("boardSection").innerHTML = renderBoardHtml(courseId, boardPosts[courseId]);
}

async function deletePost(courseId, postId) {
  if (!confirm("게시글을 삭제하시겠습니까?")) return;
  const res = await api(`/api/courses/${courseId}/board/posts/${postId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "삭제 실패"); return; }
  boardPosts[courseId] = (boardPosts[courseId] || []).filter((p) => p.id !== postId);
  document.getElementById("boardSection").innerHTML = renderBoardHtml(courseId, boardPosts[courseId]);
}

async function addComment(courseId, postId) {
  const input = document.getElementById(`cmt-${postId}`);
  const content = (input?.value || "").trim();
  if (!content) return;
  const res = await api(`/api/courses/${courseId}/board/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "댓글 등록 실패"); return; }
  const post = (boardPosts[courseId] || []).find((p) => p.id === postId);
  if (post) { if (!post.comments) post.comments = []; post.comments.push(data.comment); }
  document.getElementById("boardSection").innerHTML = renderBoardHtml(courseId, boardPosts[courseId]);
}

async function deleteComment(courseId, postId, commentId) {
  if (!confirm("댓글을 삭제하시겠습니까?")) return;
  const res = await api(`/api/courses/${courseId}/board/posts/${postId}/comments/${commentId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "삭제 실패"); return; }
  const post = (boardPosts[courseId] || []).find((p) => p.id === postId);
  if (post) post.comments = (post.comments || []).filter((c) => c.id !== commentId);
  document.getElementById("boardSection").innerHTML = renderBoardHtml(courseId, boardPosts[courseId]);
}

// ── 1:1 Q&A ─────────────────────────────────────────────────
function renderQa(courseId) {
  const section = document.getElementById("qaSection");
  section.style.display = "block";
  const myQs = (state.questions || []).filter((q) => q.courseId === courseId);
  section.innerHTML = renderQaHtml(courseId, myQs);
}

function renderQaHtml(courseId, questions) {
  const compose = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px">강사에게 질문하기</h3>
      <textarea id="qaNewText" placeholder="궁금한 점이나 어려운 부분을 자유롭게 질문해 주세요. 강사가 확인 후 답변해 드립니다."
        style="width:100%;resize:vertical;border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;
               font-size:13px;background:var(--bg);color:var(--text);min-height:100px;outline:none;
               box-sizing:border-box;font-family:inherit"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button onclick="submitQuestion('${courseId}')"
          style="padding:8px 18px;background:var(--teal);color:#fff;border:none;border-radius:8px;
                 font-size:13px;font-weight:600;cursor:pointer">질문 남기기</button>
      </div>
      <div id="qaStatus" style="font-size:12px;color:var(--muted);margin-top:4px;min-height:16px"></div>
    </div>`;

  const qsHtml = questions.length ? questions.map((q) => {
    const answered = !!q.answer;
    return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;
                          padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:12px;color:var(--muted)">${fmtDate(q.createdAt)}</span>
        <span style="font-size:11px;padding:3px 8px;border-radius:10px;font-weight:600;
                     ${answered ? "background:#f0fdf4;color:#15803d" : "background:#fef9ee;color:#92400e"}">
          ${answered ? "답변 완료" : "답변 대기 중"}</span>
      </div>
      <p style="font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word;
                margin-bottom:${answered ? "12px" : "0"}">${escHtml(q.content)}</p>
      ${answered ? `<div style="padding:12px;background:var(--bg);border-radius:8px;border-left:3px solid var(--teal)">
        <p style="font-size:12px;font-weight:600;color:var(--teal);margin-bottom:4px">강사 답변 · ${fmtDate(q.answeredAt)}</p>
        <p style="font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word">${escHtml(q.answer)}</p>
      </div>` : ""}
    </div>`;
  }).join("") : `<p style="padding:40px 0;text-align:center;color:var(--muted);font-size:13px">아직 질문이 없습니다. 위 양식으로 첫 번째 질문을 남겨보세요!</p>`;

  return `<div style="padding:24px;max-width:720px">${compose}${qsHtml}</div>`;
}

async function submitQuestion(courseId) {
  const textarea = document.getElementById("qaNewText");
  const content = (textarea?.value || "").trim();
  const statusEl = document.getElementById("qaStatus");
  if (!content) { if (statusEl) statusEl.textContent = "질문 내용을 입력해 주세요."; return; }
  const res = await api("/api/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courseId, content }),
  });
  const data = await res.json();
  if (!res.ok) { if (statusEl) statusEl.textContent = data.error || "질문 전송 실패"; return; }
  if (!state.questions) state.questions = [];
  state.questions.unshift(data.question);
  if (textarea) textarea.value = "";
  renderQa(courseId);
}

// 인라인 onclick에서 호출 가능하도록 window에 노출
window.createPost = createPost;
window.deletePost = deletePost;
window.addComment = addComment;
window.deleteComment = deleteComment;
window.submitQuestion = submitQuestion;
window.removeDevice = removeDevice;
window.changePassword = changePassword;

// ── Init ────────────────────────────────────────────────────
boot();
