/* ── admin.js ───────────────────────────────────────────── */
const API = (window.CARNIVAL_LION_API_URL || location.origin).replace(/\/$/, "");
let state = null;
let activeTab = "students";

// ── Auth + boot ─────────────────────────────────────────────
async function boot() {
  try {
    const me = await fetch(API + "/api/auth/me", { credentials: "include" });
    if (me.status === 401) { location.href = "/admin-login.html"; return; }
    const meData = await me.json();
    if (meData.role !== "admin") { location.href = "/login.html"; return; }
  } catch {
    showError("서버에 연결할 수 없습니다.");
    return;
  }
  await loadState();
}

async function loadState() {
  const res = await fetch(API + "/api/admin/state", { credentials: "include" });
  if (res.status === 401) { location.href = "/admin-login.html"; return; }
  state = await res.json();
  render();
}

async function apiFetch(path, options = {}) {
  return fetch(API + path, { credentials: "include", ...options });
}

// ── Render ──────────────────────────────────────────────────
function render() {
  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("adminApp").classList.remove("is-hidden");
  renderStats();
  renderCurrentTab();
  populateCourseSelects();
}

function renderStats() {
  const students = state.students || [];
  document.getElementById("statTotal").textContent = students.length;
  document.getElementById("statPending").textContent = (state.pendingSubmissions || []).length;
  document.getElementById("statActive").textContent = students.filter((s) => s.activeSession).length;
  document.getElementById("statR2").textContent = state.r2?.connected ? "연결됨" : "미연결";
  const badge = document.getElementById("subBadge");
  const cnt = (state.pendingSubmissions || []).length;
  badge.textContent = cnt > 0 ? cnt : "";
  badge.style.display = cnt > 0 ? "" : "none";
  const qBadge = document.getElementById("qBadge");
  const qCnt = (state.pendingQuestions || []).length;
  if (qBadge) { qBadge.textContent = qCnt > 0 ? qCnt : ""; qBadge.style.display = qCnt > 0 ? "" : "none"; }
}

function renderCurrentTab() {
  if (activeTab === "students") renderStudents();
  else if (activeTab === "submissions") renderSubmissions();
  else if (activeTab === "invite") renderInvite();
  else if (activeTab === "r2") renderR2();
  else if (activeTab === "courses") renderCourses();
  else if (activeTab === "imweb") renderImweb();
  else if (activeTab === "log") renderDrmLog();
  else if (activeTab === "questions") renderQuestions();
  else if (activeTab === "board") renderAdminBoard();
}

// ── Students ────────────────────────────────────────────────
function renderStudents(filter = "") {
  const grid = document.getElementById("studentGrid");
  let students = state.students || [];
  if (filter) {
    const q = filter.toLowerCase();
    students = students.filter((s) =>
      s.user.email.toLowerCase().includes(q) || s.user.name.toLowerCase().includes(q),
    );
  }
  if (!students.length) { grid.innerHTML = "<p class='empty-hint'>학생이 없습니다.</p>"; return; }
  grid.innerHTML = students.map((s) => {
    const u = s.user;
    const e = s.enrollment;
    const statusClass = !e ? "none" : e.status === "active" ? "active" : e.status === "refunded" ? "refunded" : "pending";
    const statusLabel = !e ? "수강권 없음" : { active: "수강 중", refunded: "환불", pending_invite: "초대 대기", pending_contract: "계약 대기" }[e.status] || e.status;
    const coursePills = (s.courses || []).map((c) => `<span class="mini-pill">${c.room} ${c.progress}%</span>`).join("");
    return `
    <div class="student-card" data-uid="${u.id}">
      <div class="sc-top">
        <div class="sc-avatar">${(u.name || u.email)[0].toUpperCase()}</div>
        <div class="sc-info">
          <strong class="sc-name">${escHtml(u.name)}</strong>
          <span class="sc-email">${escHtml(u.email)}</span>
          <span class="sc-id">${u.memberId}</span>
        </div>
        <span class="sc-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="sc-courses">${coursePills || "<span class='muted-text'>강의 없음</span>"}</div>
      <div class="sc-footer">
        <span>${e?.contractSigned ? "✓ 계약" : "계약 미서명"}</span>
        <span>${s.pendingFeedback > 0 ? `피드백 ${s.pendingFeedback}건` : ""}</span>
        ${s.activeSession ? "<span class='live-dot'>● 시청 중</span>" : ""}
      </div>
      <div class="sc-actions">
        <button class="ghost-action micro" onclick="openStudentModal('${u.id}')">상세 보기</button>
        <button class="ghost-action micro" onclick="resendInvite('${u.id}', '${escHtml(u.email)}')">초대 재발송</button>
        <button class="ghost-action micro" onclick="window.open('/student.html?preview=${u.id}','_blank')" title="학생 페이지 미리보기">학생 화면 보기</button>
      </div>
    </div>`;
  }).join("");
}

document.getElementById("studentSearch").addEventListener("input", (e) => {
  renderStudents(e.target.value.trim());
});

// ── Student modal ────────────────────────────────────────────
function openStudentModal(userId) {
  const s = (state.students || []).find((s) => s.user.id === userId);
  if (!s) return;
  const u = s.user;
  const e = s.enrollment;
  document.getElementById("modalStudentName").textContent = `${u.name} (${u.email})`;
  document.getElementById("modalPreviewBtn").onclick = () => window.open(`/student.html?preview=${u.id}`, "_blank");
  const submissions = (state.recentSubmissions || []).filter((sub) => sub.userId === userId);
  document.getElementById("modalBody").innerHTML = `
    <div class="modal-section">
      <h3>기본 정보</h3>
      <dl class="info-dl">
        <dt>이메일</dt><dd>${escHtml(u.email)}</dd>
        <dt>회원번호</dt><dd>${u.memberId}</dd>
        <dt>가입일</dt><dd>${u.createdAt || "-"}</dd>
        <dt>이메일 인증</dt><dd>${e?.emailVerified ? "완료" : "미완료"}</dd>
        <dt>계약서</dt><dd>${e?.contractSigned ? "서명 완료" : "미서명"}
          ${e?.contractSigned ? `<button class="ghost-action micro" onclick="resetContract('${u.id}')">초기화</button>` : ""}
        </dd>
        <dt>수강 상태</dt><dd>${e?.status || "없음"}</dd>
      </dl>
    </div>
    <div class="modal-section">
      <h3>강의 수강 현황</h3>
      <ul class="course-progress-list" id="modalCourseList">
        ${(s.courses || []).map((c) => `
          <li><span>${c.room} · ${c.title}</span>
          <div class="mini-progress"><div class="mini-fill" style="width:${c.progress}%"></div></div>
          <span>${c.progress}%</span>
          <button class="ghost-action micro" style="margin-left:auto" onclick="toggleStudentCourse('${u.id}','${c.id}','remove')">해제</button>
          </li>`).join("") || "<li class='empty-hint'>강의 없음</li>"}
      </ul>
      <div style="margin-top:10px">
        <select id="modalAddCourseSelect" class="admin-select" style="width:auto;margin-right:8px">
          <option value="">강의 추가...</option>
          ${(state.courses || []).filter((c) => !(e?.courseIds || []).includes(c.id)).map((c) => `<option value="${c.id}">${c.title}</option>`).join("")}
        </select>
        <button class="ghost-action micro" onclick="toggleStudentCourse('${u.id}', document.getElementById('modalAddCourseSelect').value, 'add')">추가</button>
      </div>
    </div>
    <div class="modal-section">
      <h3>DRM 세션</h3>
      ${s.activeSession ? `
        <p>현재 재생 중: <strong>${s.activeSession.chapterLabel}</strong></p>
        <p>기기: ${s.activeSession.deviceLabel || "-"}</p>
        <button class="ghost-action micro" onclick="revokeSession('${u.id}')">세션 강제 종료</button>
        <button class="ghost-action micro" onclick="resetDevices('${u.id}')">기기 초기화</button>
      ` : `
        <p class="muted-text">활성 세션 없음 (${(s.devices || []).length}대 등록)</p>
        <button class="ghost-action micro" onclick="resetDevices('${u.id}')">기기 초기화</button>
      `}
    </div>
    <div class="modal-section">
      <h3>비밀번호</h3>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="password" id="resetPwInput_${u.id}" placeholder="새 비밀번호 (8자 이상)" class="admin-input" style="flex:1;min-width:160px">
        <button class="ghost-action micro" onclick="resetPassword('${u.id}')">비밀번호 초기화</button>
      </div>
    </div>
    <div class="modal-section">
      <h3>초대 링크</h3>
      <p class="muted-text" style="font-size:12px;margin-bottom:8px">학생이 이 링크로 접속하면 계정이 활성화됩니다. 카카오톡이나 이메일로 직접 전달하세요.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ghost-action micro" onclick="regenInviteLink('${u.id}')">새 초대 링크 생성</button>
        <button class="ghost-action micro" onclick="window.open('${window.CARNIVAL_LION_API_URL || ''}/student.html?preview=${u.id}','_blank')">강의실 화면 보기</button>
      </div>
    </div>
    <div class="modal-section">
      <h3>제출 과제 (${submissions.length}건)</h3>
      <ul class="modal-submissions">
        ${submissions.length ? submissions.map((sub) => `
          <li class="modal-sub-item">
            <div class="modal-sub-header">
              <span class="pill">${sub.chapterLabel}</span>
              <span>${sub.createdAt}</span>
              <span class="${sub.status === "feedback_sent" ? "status-done" : "status-wait"}">${sub.status === "feedback_sent" ? "완료" : "대기"}</span>
            </div>
            <p class="modal-sub-text">${escHtml(sub.text)}</p>
            ${sub.feedback ? `<p class="modal-feedback">✓ ${escHtml(sub.feedback)}</p>` : ""}
            ${sub.status !== "feedback_sent" ? `
              <div class="feedback-form">
                <textarea class="feedback-input" id="fb_${sub.id}" rows="2" placeholder="피드백 입력..."></textarea>
                <button class="primary-action small" onclick="sendFeedback('${sub.id}', '${sub.id}')">피드백 발송</button>
              </div>` : ""}
          </li>`).join("") : "<li class='empty-hint'>제출 없음</li>"}
      </ul>
    </div>
  `;
  document.getElementById("studentModal").showModal();
}

document.getElementById("modalClose").addEventListener("click", () => {
  document.getElementById("studentModal").close();
});

// ── Submissions ──────────────────────────────────────────────
function renderSubmissions() {
  const queue = document.getElementById("submissionQueue");
  const subs = state.pendingSubmissions || [];
  if (!subs.length) { queue.innerHTML = "<li class='empty-hint'>대기 중인 과제가 없습니다.</li>"; return; }
  queue.innerHTML = subs.map((sub) => `
    <li class="queue-item">
      <div class="queue-header">
        <strong>${escHtml(sub.studentName)}</strong>
        <span class="muted-text">${sub.studentEmail}</span>
        <span class="pill">${sub.chapterLabel} · ${escHtml(sub.chapterTitle)}</span>
        <span class="muted-text">${sub.createdAt}</span>
      </div>
      <p class="queue-text">${escHtml(sub.text)}</p>
      <div class="feedback-form">
        <textarea class="feedback-input" id="qfb_${sub.id}" rows="2" placeholder="피드백을 입력하세요..."></textarea>
        <button class="primary-action small" onclick="sendFeedbackFromQueue('${sub.id}')">피드백 발송</button>
      </div>
    </li>`).join("");
}

async function sendFeedbackFromQueue(submissionId) {
  const el = document.getElementById(`qfb_${submissionId}`);
  const feedback = el?.value.trim();
  await postFeedback(submissionId, feedback);
}

async function sendFeedback(submissionId) {
  const el = document.getElementById(`fb_${submissionId}`);
  const feedback = el?.value.trim();
  await postFeedback(submissionId, feedback);
  document.getElementById("studentModal").close();
}

async function postFeedback(submissionId, feedback) {
  const res = await apiFetch("/api/admin/submissions/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId, feedback }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "피드백 발송 실패"); return; }
  state = await res.json();
  renderStats();
  renderSubmissions();
}

// ── Invite ───────────────────────────────────────────────────
function renderInvite() {
  renderInviteLog();
}

function renderInviteLog() {
  const log = document.getElementById("inviteLog");
  const invites = (state.invitations || []).slice(0, 20);
  if (!invites.length) { log.innerHTML = "<li class='empty-hint'>초대 내역이 없습니다.</li>"; return; }
  log.innerHTML = invites.map((inv) => `
    <li class="invite-item">
      <span class="invite-email">${escHtml(inv.email)}</span>
      <span class="pill ${inv.status === "used" ? "done" : inv.status === "revoked" ? "muted" : ""}">${inv.status}</span>
      <span class="muted-text">${inv.sentAt || ""}</span>
      ${inv.status === "sent" ? `<a class="invite-link" href="${inv.inviteUrl}" target="_blank">링크 열기</a>` : ""}
    </li>`).join("");
}

async function inviteStudent() {
  const email = document.getElementById("inviteEmail").value.trim();
  const name = document.getElementById("inviteName").value.trim();
  const orderNo = document.getElementById("inviteOrderNo").value.trim();
  const status = document.getElementById("inviteStatus");
  const courseIds = [...document.querySelectorAll(".course-check:checked")].map((el) => el.value);
  if (!email) { status.textContent = "이메일을 입력해 주세요."; status.className = "form-status error"; return; }
  const btn = document.getElementById("inviteBtn");
  btn.disabled = true;
  try {
    const res = await apiFetch("/api/admin/students/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, orderNo, courseIds }),
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error || "초대 실패"; status.className = "form-status error"; return; }
    state = data;
    status.textContent = `${email}에 초대 링크를 발송했습니다.`;
    status.className = "form-status success";
    document.getElementById("inviteEmail").value = "";
    document.getElementById("inviteName").value = "";
    document.getElementById("inviteOrderNo").value = "";
    renderStats();
    renderInviteLog();
  } finally { btn.disabled = false; }
}

async function resendInvite(userId, email) {
  if (!confirm(`${email}에 초대 링크를 재발송할까요?`)) return;
  const res = await apiFetch("/api/admin/invitations/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "재발송 실패"); return; }
  state = await res.json();
  alert("초대 링크를 재발송했습니다.");
  renderStudents(document.getElementById("studentSearch").value);
}

// ── DRM actions ──────────────────────────────────────────────
async function revokeSession(userId) {
  if (!confirm("이 학생의 재생 세션을 강제 종료할까요?")) return;
  const res = await apiFetch("/api/admin/drm/sessions/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "실패"); return; }
  state = await res.json();
  document.getElementById("studentModal").close();
  renderStats();
  renderStudents(document.getElementById("studentSearch").value);
}

async function resetDevices(userId) {
  if (!confirm("이 학생의 기기 목록을 초기화할까요? 현재 세션도 종료됩니다.")) return;
  const res = await apiFetch("/api/admin/drm/devices/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "실패"); return; }
  state = await res.json();
  document.getElementById("studentModal").close();
  renderStats();
  renderStudents(document.getElementById("studentSearch").value);
}

async function resetContract(userId) {
  if (!confirm("이 학생의 계약서를 초기화할까요?")) return;
  const res = await apiFetch("/api/admin/contracts/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "실패"); return; }
  state = await res.json();
  document.getElementById("studentModal").close();
  renderStudents(document.getElementById("studentSearch").value);
}

// ── R2 ────────────────────────────────────────────────────────
async function renderR2() {
  const statusCard = document.getElementById("r2StatusCard");
  try {
    const res = await apiFetch("/api/admin/r2/status");
    const d = await res.json();
    statusCard.innerHTML = d.r2Connected
      ? `<p class="status-ok">R2 연결됨 · 버킷: <strong>${d.bucket}</strong> · 파일 ${d.videoCount}개</p>`
      : `<p class="status-err">R2 미연결 — Railway 환경변수를 확인하세요.</p>`;
    if (d.r2Connected) loadR2Files();
  } catch {
    statusCard.innerHTML = `<p class="status-err">R2 상태 확인 실패</p>`;
  }
}

async function loadR2Files() {
  const list = document.getElementById("r2FileList");
  try {
    const res = await apiFetch("/api/admin/r2/videos");
    if (!res.ok) { list.innerHTML = "<li class='empty-hint'>영상 목록 로드 실패</li>"; return; }
    const d = await res.json();
    if (!d.files?.length) { list.innerHTML = "<li class='empty-hint'>업로드된 영상이 없습니다.</li>"; return; }
    list.innerHTML = d.files.map((f) => {
      const sizeMB = (f.size / (1024 * 1024)).toFixed(1);
      const keyEsc = escHtml(f.key);
      const keySafe = f.key.replace(/'/g, "\\'");
      return `<li class="r2-file-item" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border)">
        <span class="r2-key" style="flex:1;min-width:0;font-size:13px;word-break:break-all">${keyEsc}</span>
        <span class="muted-text" style="white-space:nowrap">${sizeMB} MB</span>
        <span class="muted-text" style="white-space:nowrap">${new Date(f.lastModified).toLocaleDateString("ko-KR")}</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button onclick="previewR2Video('${keySafe}')"
            style="font-size:12px;padding:4px 10px;border:1px solid var(--teal);border-radius:6px;background:transparent;color:var(--teal);cursor:pointer">미리보기</button>
          <button onclick="deleteR2Video('${keySafe}')"
            style="font-size:12px;padding:4px 10px;border:1px solid #e53e3e;border-radius:6px;background:transparent;color:#e53e3e;cursor:pointer">삭제</button>
        </div>
      </li>`;
    }).join("");
  } catch { list.innerHTML = "<li class='empty-hint'>목록 로드 실패</li>"; }
}

async function deleteR2Video(key) {
  if (!confirm(`"${key}" 영상을 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) return;
  const res = await apiFetch("/api/admin/r2/videos", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "삭제 실패"); return; }
  loadR2Files();
  renderR2();
}

async function previewR2Video(key) {
  const modal = document.getElementById("videoPreviewModal");
  const video = document.getElementById("previewVideo");
  const status = document.getElementById("previewModalStatus");
  const title = document.getElementById("previewModalTitle");
  title.textContent = key;
  video.src = "";
  status.textContent = "미리보기 URL 생성 중...";
  modal.showModal();
  try {
    const res = await apiFetch("/api/admin/r2/preview-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const d = await res.json();
    if (!res.ok) { status.textContent = d.error || "URL 생성 실패"; return; }
    video.src = d.previewUrl;
    status.textContent = "미리보기 URL은 5분 후 만료됩니다.";
  } catch (e) {
    status.textContent = "미리보기 로드 실패: " + e.message;
  }
}

function closeVideoPreview() {
  const modal = document.getElementById("videoPreviewModal");
  const video = document.getElementById("previewVideo");
  video.pause();
  video.src = "";
  modal.close();
}

function populateCourseSelects() {
  const courses = state.courses || [];
  const courseChecks = document.getElementById("courseChecks");
  courseChecks.innerHTML = courses.map((c) => `
    <label class="check-row">
      <input type="checkbox" class="course-check" value="${c.id}" checked>
      <span>${c.room} · ${c.title}</span>
    </label>`).join("");

  const r2CourseSelect = document.getElementById("r2CourseId");
  r2CourseSelect.innerHTML = courses.map((c) => `<option value="${c.id}">${c.room} · ${c.title}</option>`).join("");
  r2CourseSelect.dispatchEvent(new Event("change"));

  const boardCourseSelect = document.getElementById("boardCourseSelect");
  if (boardCourseSelect) {
    boardCourseSelect.innerHTML = courses.map((c) => `<option value="${c.id}">${c.room} · ${c.title}</option>`).join("");
  }
}

document.getElementById("r2CourseId").addEventListener("change", () => {
  const courseId = document.getElementById("r2CourseId").value;
  const course = (state?.courses || []).find((c) => c.id === courseId);
  const chapSel = document.getElementById("r2ChapterId");
  chapSel.innerHTML = (course?.chapters || []).map((ch) => `<option value="${ch.id}">${ch.label} · ${ch.title}</option>`).join("");
});

document.getElementById("r2UploadBtn").addEventListener("click", async () => {
  const courseId = document.getElementById("r2CourseId").value;
  const chapterId = document.getElementById("r2ChapterId").value;
  const file = document.getElementById("r2FileInput").files[0];
  const status = document.getElementById("r2Status");
  if (!courseId || !chapterId) { status.textContent = "강의와 챕터를 선택해 주세요."; status.className = "form-status error"; return; }
  if (!file) { status.textContent = "파일을 선택해 주세요."; status.className = "form-status error"; return; }

  const btn = document.getElementById("r2UploadBtn");
  btn.disabled = true;
  status.textContent = "업로드 URL 생성 중...";
  status.className = "form-status";

  try {
    const urlRes = await apiFetch("/api/admin/r2/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, chapterId, contentType: file.type || "video/mp4" }),
    });
    if (!urlRes.ok) { const d = await urlRes.json(); throw new Error(d.error || "URL 생성 실패"); }
    const { uploadUrl, key } = await urlRes.json();

    document.getElementById("uploadProgress").style.display = "";
    status.textContent = `업로드 중: ${key}`;

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          document.getElementById("progressFill").style.width = pct + "%";
          document.getElementById("progressLabel").textContent = pct + "%";
        }
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error("업로드 실패"));
      xhr.send(file);
    });

    status.textContent = "업로드 완료!";
    status.className = "form-status success";
    document.getElementById("r2FileInput").value = "";
    loadR2Files();
  } catch (err) {
    status.textContent = err.message;
    status.className = "form-status error";
  } finally {
    btn.disabled = false;
    setTimeout(() => { document.getElementById("uploadProgress").style.display = "none"; }, 3000);
  }
});

// ── DRM log ──────────────────────────────────────────────────
function renderDrmLog() {
  const list = document.getElementById("drmLogList");
  const logs = state.drm?.licenseLog || [];
  if (!logs.length) { list.innerHTML = "<li class='empty-hint'>이벤트가 없습니다.</li>"; return; }
  list.innerHTML = logs.map((l) => `
    <li class="log-item ${l.status}">
      <span class="log-type">${l.title}</span>
      <span class="log-status">${l.statusLabel}</span>
      <span class="log-detail">${escHtml(l.detail)}</span>
      <span class="muted-text">${l.createdAt}</span>
    </li>`).join("");
}

// ── Tabs ─────────────────────────────────────────────────────
document.querySelectorAll(".admin-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".admin-tab-content").forEach((s) => s.classList.add("is-hidden"));
    btn.classList.add("is-active");
    activeTab = btn.dataset.tab;
    const tabMap = { students: "tabStudents", submissions: "tabSubmissions", invite: "tabInvite", r2: "tabR2", courses: "tabCourses", imweb: "tabImweb", log: "tabLog", questions: "tabQuestions", board: "tabBoard" };
    document.getElementById(tabMap[activeTab])?.classList.remove("is-hidden");
    renderCurrentTab();
  });
});

// ── Global actions ────────────────────────────────────────────
document.getElementById("inviteBtn").addEventListener("click", inviteStudent);

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await apiFetch("/api/auth/admin/logout", { method: "POST" });
  location.href = "/admin-login.html";
});

document.getElementById("refreshBtn").addEventListener("click", loadState);

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showError(msg) {
  document.getElementById("loadingScreen").innerHTML = `
    <div class="loader-inner">
      <p style="color:#b94d58;font-size:15px">${msg}</p>
      <button onclick="location.href='/admin-login.html'" style="margin-top:16px;padding:8px 20px;border:1px solid #ccc;border-radius:8px;cursor:pointer">로그인으로 이동</button>
    </div>`;
}

// ── Courses ───────────────────────────────────────────────────
function renderCourses() {
  const list = document.getElementById("courseList");
  const courses = state.courses || [];
  if (!courses.length) {
    list.innerHTML = "<p class='empty-hint'>강의가 없습니다. 위에서 추가하세요.</p>";
    return;
  }
  list.innerHTML = courses.map((c) => {
    return `
    <div class="course-card" data-cid="${c.id}">
      <div class="course-card-header" style="flex-wrap:wrap;gap:6px">
        <span class="course-room-badge" style="align-self:center">${escHtml(c.room)}</span>
        <strong style="align-self:center">${escHtml(c.title)}</strong>
        <button class="ghost-action micro danger" style="margin-left:auto" onclick="deleteCourse('${c.id}','${escHtml(c.title)}')">삭제</button>
        <div style="width:100%;display:flex;gap:6px;align-items:center;padding:6px 0">
          <input type="text" id="cRoom_${c.id}" value="${escHtml(c.room)}" placeholder="강의실명"
            style="width:90px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text)">
          <input type="text" id="cTitle_${c.id}" value="${escHtml(c.title)}" placeholder="강의 제목"
            style="flex:1;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text)">
          <button class="ghost-action micro" onclick="updateCourseMeta('${c.id}')">저장</button>
        </div>
      </div>

      <div class="chapter-list" id="chapterList_${c.id}">
        ${(c.chapters || []).map((ch) => `
          <div class="chapter-row" style="flex-wrap:wrap;gap:6px">
            <span class="chapter-label">${ch.label}</span>
            <span style="flex:1">${escHtml(ch.title)}</span>
            ${ch.duration ? `<span class="muted-text">${ch.duration}</span>` : ""}
            <button class="ghost-action micro danger" onclick="deleteChapter('${c.id}','${ch.id}','${escHtml(ch.title)}')">삭제</button>
            <div style="width:100%;display:flex;gap:6px;align-items:flex-start;margin-top:4px">
              <textarea id="assign_${ch.id}" rows="2" placeholder="과제 내용 입력 (없으면 비워두세요)"
                style="flex:1;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;
                       background:var(--bg);color:var(--text);resize:vertical;font-family:inherit;outline:none">${escHtml(ch.assignment || "")}</textarea>
              <button class="ghost-action micro" onclick="updateChapterAssignment('${c.id}','${ch.id}')">저장</button>
            </div>
          </div>`).join("") || "<p class='empty-hint' style='padding:8px 0'>챕터 없음</p>"}
      </div>
      <div class="add-chapter-row">
        <input type="text" class="admin-search" placeholder="새 챕터 제목" id="chInput_${c.id}" style="flex:1">
        <input type="text" class="admin-search" placeholder="시간 (예: 12:30)" id="chDur_${c.id}" style="width:90px">
        <button class="ghost-action micro" onclick="addChapter('${c.id}')">+ 챕터</button>
      </div>
    </div>`;
  }).join("");
}

async function updateChapterAssignment(courseId, chapterId) {
  const el = document.getElementById(`assign_${chapterId}`);
  const assignment = el?.value || "";
  const res = await apiFetch(`/api/admin/courses/${courseId}/chapters/${chapterId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignment }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "저장 실패"); return; }
  state = await res.json();
  alert("과제 내용이 저장되었습니다.");
}

async function updateCourseMeta(courseId) {
  const room = document.getElementById(`cRoom_${courseId}`)?.value.trim();
  const title = document.getElementById(`cTitle_${courseId}`)?.value.trim();
  if (!room || !title) { alert("강의실명과 강의 제목을 입력하세요."); return; }
  const res = await apiFetch(`/api/admin/courses/${courseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, title }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "저장 실패"); return; }
  state = await res.json();
  renderCourses();
}
window.updateCourseMeta = updateCourseMeta;

// ── Admin Board ───────────────────────────────────────────────
async function renderAdminBoard() {
  const sel = document.getElementById("boardCourseSelect");
  if (!sel) return;
  if (!sel._listenerAdded) {
    sel.addEventListener("change", () => loadAdminBoard(sel.value));
    sel._listenerAdded = true;
  }
  if (sel.value) loadAdminBoard(sel.value);
}

async function loadAdminBoard(courseId) {
  const container = document.getElementById("adminBoardContent");
  container.innerHTML = `<p class="empty-hint">불러오는 중...</p>`;
  try {
    const res = await apiFetch(`/api/admin/board/${courseId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "로드 실패");
    const posts = data.posts || [];
    if (!posts.length) { container.innerHTML = `<p class="empty-hint">게시글이 없습니다.</p>`; return; }
    container.innerHTML = posts.map((post) => {
      const cmts = post.comments || [];
      const cmtsHtml = cmts.map((c) => `
        <div style="padding:8px 12px;border-left:2px solid var(--border);margin-left:12px;margin-top:6px;font-size:13px">
          <strong>${escHtml(c.nickname)}</strong>
          <span style="font-size:11px;color:var(--muted);margin-left:6px">${fmtDate(c.createdAt)}</span>
          <p style="margin-top:3px;white-space:pre-wrap;word-break:break-word">${escHtml(c.content)}</p>
          <button class="ghost-action micro danger" style="margin-top:4px;font-size:11px"
            onclick="adminDeleteComment('${courseId}','${post.id}','${c.id}')">댓글 삭제</button>
        </div>`).join("");
      return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div>
            <strong>${escHtml(post.nickname)}</strong>
            <span style="font-size:12px;color:var(--muted);margin-left:8px">${fmtDate(post.createdAt)}</span>
          </div>
          <button class="ghost-action micro danger" onclick="adminDeletePost('${courseId}','${post.id}')">삭제</button>
        </div>
        <p style="font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word">${escHtml(post.content)}</p>
        ${cmtsHtml}
        <div style="display:flex;gap:6px;margin-top:10px">
          <input type="text" id="adminCmt_${post.id}" placeholder="관리자 댓글..."
            style="flex:1;padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
          <button class="ghost-action micro" onclick="adminAddComment('${courseId}','${post.id}')">등록</button>
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    container.innerHTML = `<p style="color:#e53e3e;font-size:13px">${e.message}</p>`;
  }
}

async function adminDeletePost(courseId, postId) {
  if (!confirm("게시글을 삭제하시겠습니까?")) return;
  const res = await apiFetch(`/api/admin/board/${courseId}/posts/${postId}`, { method: "DELETE" });
  if (!res.ok) { const d = await res.json(); alert(d.error || "삭제 실패"); return; }
  state = await res.json();
  loadAdminBoard(courseId);
}

async function adminDeleteComment(courseId, postId, commentId) {
  if (!confirm("댓글을 삭제하시겠습니까?")) return;
  const res = await apiFetch(`/api/admin/board/${courseId}/posts/${postId}/comments/${commentId}`, { method: "DELETE" });
  if (!res.ok) { const d = await res.json(); alert(d.error || "삭제 실패"); return; }
  loadAdminBoard(courseId);
}

async function adminAddComment(courseId, postId) {
  const input = document.getElementById(`adminCmt_${postId}`);
  const content = (input?.value || "").trim();
  if (!content) return;
  const res = await apiFetch(`/api/admin/board/${courseId}/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "등록 실패"); return; }
  loadAdminBoard(courseId);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "방금";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

async function saveImwebMapping(courseId) {
  const sel = document.getElementById(`imwebMapCode_${courseId}`);
  const productId = sel.tagName === "SELECT"
    ? sel.value.trim()
    : sel.value.trim();
  const selectedOpt = sel.tagName === "SELECT" ? sel.options[sel.selectedIndex] : null;
  const imwebProductLabel = selectedOpt && selectedOpt.value
    ? selectedOpt.dataset.name || ""
    : (document.getElementById(`imwebMapLabel_${courseId}`)?.value.trim() || "");
  const res = await apiFetch(`/api/admin/courses/${courseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, imwebProductLabel }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "저장 실패"); return; }
  state = data;
  renderImwebMappingTable();
}

// ── Imweb tab ─────────────────────────────────────────────────
let _imwebProducts = null;

async function renderImweb() {
  if (!_imwebProducts) {
    try {
      const res = await apiFetch("/api/admin/imweb/products");
      const data = await res.json();
      _imwebProducts = res.ok ? (data.data?.list || []) : [];
    } catch (e) { _imwebProducts = []; }
  }
  renderImwebMappingTable();
}

function renderImwebMappingTable() {
  const el = document.getElementById("imwebMappingTable");
  const courses = state.courses || [];
  const products = _imwebProducts || [];

  el.innerHTML = `
    <table class="imweb-table">
      <thead>
        <tr>
          <th>LMS 강의</th>
          <th>아임웹 상품</th>
          <th>상태</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${courses.map((c) => {
          const hasCode = !!(c.productId && c.productId.trim());
          const matched = products.find(
            (p) => String(p.no) === String(c.productId) || (p.custom_prod_code && p.custom_prod_code === c.productId)
          );
          const cellHtml = products.length > 0
            ? `<select class="imweb-cell-input" id="imwebMapCode_${c.id}" style="width:100%;max-width:280px">
                <option value="">-- 미설정 --</option>
                ${products.map((p) => {
                  const val = p.custom_prod_code || String(p.no);
                  const sel2 = (val === c.productId || String(p.no) === String(c.productId)) ? "selected" : "";
                  return `<option value="${escHtml(val)}" data-name="${escHtml(p.name)}" ${sel2}>${escHtml(p.name)} (no.${p.no})</option>`;
                }).join("")}
              </select>`
            : `<input type="text" class="imweb-cell-input" id="imwebMapCode_${c.id}"
                value="${escHtml(c.productId || '')}" placeholder="직접 입력">
               <input type="hidden" id="imwebMapLabel_${c.id}" value="${escHtml(c.imwebProductLabel || '')}">`;
          const statusHtml = hasCode
            ? (matched
                ? `<span class="mapping-ok">● ${escHtml(matched.name)}</span>`
                : `<span class="mapping-warn">● 코드불일치</span>`)
            : `<span class="muted-text">● 미설정</span>`;
          return `<tr>
            <td><span class="course-room-badge">${escHtml(c.room)}</span> ${escHtml(c.title)}</td>
            <td>${cellHtml}</td>
            <td>${statusHtml}</td>
            <td><button class="ghost-action micro" onclick="saveImwebMapping('${c.id}')">저장</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <p class="muted-text" style="font-size:12px;margin-top:8px">상품 선택 후 저장하면 해당 상품 구매 시 자동으로 수강권이 생성됩니다.</p>`;
}

async function loadImwebOrders(page = 1) {
  const el = document.getElementById("imwebOrdersTable");
  el.innerHTML = "<p class='muted-text'>불러오는 중...</p>";
  const res = await apiFetch(`/api/admin/imweb/orders?page=${page}&limit=30`);
  const data = await res.json();
  if (!res.ok) { el.innerHTML = `<p class="form-error">${data.error || "오류"}</p>`; return; }

  const orders = data.data?.list || data.data || [];
  const total = data.data?.totalCount || data.data?.total_count || orders.length;
  if (!orders.length) { el.innerHTML = "<p class='empty-hint'>결제 내역이 없습니다.</p>"; return; }

  el.innerHTML = `
    <p class="muted-text" style="font-size:12px;margin-bottom:8px">총 ${total}건</p>
    <div class="imweb-table-wrap">
    <table class="imweb-table">
      <thead><tr>
        <th>주문번호</th><th>구매자</th><th>이메일</th><th>금액</th><th>일시</th><th>LMS 상태</th><th>액션</th>
      </tr></thead>
      <tbody>
        ${orders.map((o) => {
          const buyerName = o.orderer?.name || "";
          const buyerEmail = (o.orderer?.email || "").toLowerCase();
          const orderNo = o.order_no || "";
          const price = o.payment?.payment_amount || o.payment?.total_price || 0;
          const priceStr = price ? price.toLocaleString() + "원" : "-";
          const payTs = o.payment?.payment_time;
          const dateStr = payTs ? new Date(payTs * 1000).toLocaleDateString("ko-KR") : "-";
          const lmsStudent = (state.students || []).find((s) => s.user.email.toLowerCase() === buyerEmail);
          const lmsStatusHtml = lmsStudent
            ? (lmsStudent.enrollment?.status === "active"
                ? `<span class="mapping-ok">● 수강중</span>`
                : `<span class="mapping-warn">● ${escHtml(lmsStudent.enrollment?.status || "등록됨")}</span>`)
            : `<span class="muted-text">미등록</span>`;
          const actionHtml = lmsStudent
            ? `<div style="display:flex;gap:4px;flex-wrap:wrap">
                 <button class="ghost-action micro" onclick="window.open('/student.html?preview=${lmsStudent.user.id}','_blank')">강의실 보기</button>
                 <button class="ghost-action micro" onclick="regenInviteLink('${lmsStudent.user.id}')">링크 재발급</button>
               </div>`
            : `<button class="ghost-action micro" onclick="openOrderInvite('${escHtml(buyerEmail)}','${escHtml(buyerName)}','${escHtml(orderNo)}')">초대 링크 생성</button>`;
          return `<tr>
            <td class="mono">${escHtml(orderNo || "-")}</td>
            <td>${escHtml(buyerName || "-")}</td>
            <td>${escHtml(buyerEmail || "-")}</td>
            <td>${escHtml(priceStr)}</td>
            <td>${escHtml(dateStr)}</td>
            <td>${lmsStatusHtml}</td>
            <td>${actionHtml}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      ${page > 1 ? `<button class="ghost-action micro" onclick="loadImwebOrders(${page-1})">이전</button>` : ""}
      <span class="muted-text" style="font-size:12px">${page}페이지</span>
      ${orders.length >= 30 ? `<button class="ghost-action micro" onclick="loadImwebOrders(${page+1})">다음</button>` : ""}
    </div>`;
}

async function loadImwebMembers(page = 1) {
  const el = document.getElementById("imwebMembersTable");
  el.innerHTML = "<p class='muted-text'>불러오는 중...</p>";
  const res = await apiFetch(`/api/admin/imweb/members?page=${page}&limit=30`);
  const data = await res.json();
  if (!res.ok) { el.innerHTML = `<p class="form-error">${data.error || "오류"}</p>`; return; }

  const members = data.data?.list || data.data || [];
  const total = data.data?.totalCount || data.data?.total_count || members.length;
  if (!members.length) { el.innerHTML = "<p class='empty-hint'>회원이 없습니다.</p>"; return; }

  el.innerHTML = `
    <p class="muted-text" style="font-size:12px;margin-bottom:8px">총 ${total}명</p>
    <div class="imweb-table-wrap">
    <table class="imweb-table">
      <thead><tr>
        <th>이름</th><th>이메일</th><th>연락처</th><th>가입일</th><th>LMS 등록</th>
      </tr></thead>
      <tbody>
        ${members.map((m) => {
          const email = (m.email || m.uid || "").toLowerCase();
          const inLms = (state.students || []).some((s) => s.user.email.toLowerCase() === email);
          return `<tr>
            <td>${escHtml(m.name || "-")}</td>
            <td>${escHtml(email || "-")}</td>
            <td>${escHtml(m.callnum || m.phone || "-")}</td>
            <td>${escHtml((m.join_time || "").slice(0, 10))}</td>
            <td>${inLms ? "<span class='mapping-ok'>● LMS 등록</span>" : "<span class='muted-text'>미등록</span>"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      ${page > 1 ? `<button class="ghost-action micro" onclick="loadImwebMembers(${page-1})">이전</button>` : ""}
      <span class="muted-text" style="font-size:12px">${page}페이지</span>
      ${members.length >= 30 ? `<button class="ghost-action micro" onclick="loadImwebMembers(${page+1})">다음</button>` : ""}
    </div>`;
}

// 아임웹 상품 새로고침 (드롭다운 갱신)
async function loadImwebProducts() {
  _imwebProducts = null;
  await renderImweb();
}

async function deleteCourse(courseId, title) {
  if (!confirm(`"${title}" 강의를 삭제하시겠습니까?\n(수강생 수강 목록에서도 제거됩니다.)`)) return;
  const res = await apiFetch(`/api/admin/courses/${courseId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "삭제 실패"); return; }
  state = data;
  renderCourses();
  populateCourseSelects();
}

async function addChapter(courseId) {
  const titleEl = document.getElementById(`chInput_${courseId}`);
  const durEl = document.getElementById(`chDur_${courseId}`);
  const title = titleEl.value.trim();
  if (!title) { alert("챕터 제목을 입력하세요."); return; }
  const res = await apiFetch(`/api/admin/courses/${courseId}/chapters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, duration: durEl.value.trim() }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "추가 실패"); return; }
  state = data;
  titleEl.value = ""; durEl.value = "";
  renderCourses();
  populateCourseSelects();
}

async function deleteChapter(courseId, chapterId, title) {
  if (!confirm(`"${title}" 챕터를 삭제하시겠습니까?`)) return;
  const res = await apiFetch(`/api/admin/courses/${courseId}/chapters/${chapterId}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "삭제 실패"); return; }
  state = data;
  renderCourses();
  populateCourseSelects();
}

async function toggleStudentCourse(userId, courseId, action) {
  if (!courseId) { alert("강의를 선택하세요."); return; }
  const res = await apiFetch(`/api/admin/students/${userId}/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, courseId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "실패"); return; }
  state = data;
  openStudentModal(userId);
}

// ── Imweb button listeners ─────────────────────────────────────
document.getElementById("loadImwebOrdersBtn")?.addEventListener("click", () => loadImwebOrders(1));
document.getElementById("loadImwebMembersBtn")?.addEventListener("click", () => loadImwebMembers(1));
document.getElementById("loadImwebProductsBtn")?.addEventListener("click", loadImwebProducts);

// ── Add course form ────────────────────────────────────────────
document.getElementById("addCourseBtn")?.addEventListener("click", () => {
  document.getElementById("addCourseForm").classList.toggle("is-hidden");
});
document.getElementById("cancelCourseBtn")?.addEventListener("click", () => {
  document.getElementById("addCourseForm").classList.add("is-hidden");
});
document.getElementById("saveCourseBtn")?.addEventListener("click", async () => {
  const title = document.getElementById("newCourseTitle").value.trim();
  const room = document.getElementById("newCourseRoom").value.trim();
  const statusEl = document.getElementById("courseFormStatus");
  if (!title) { statusEl.textContent = "강의 제목을 입력하세요."; return; }
  statusEl.textContent = "저장 중...";
  const res = await apiFetch("/api/admin/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, room }),
  });
  const data = await res.json();
  if (!res.ok) { statusEl.textContent = data.error || "실패"; return; }
  state = data;
  document.getElementById("newCourseTitle").value = "";
  document.getElementById("newCourseRoom").value = "";
  document.getElementById("addCourseForm").classList.add("is-hidden");
  statusEl.textContent = "";
  renderCourses();
  populateCourseSelects();
});

// ── Invite link popup ──────────────────────────────────────────
function showInviteLinkPopup(inviteUrl) {
  let overlay = document.getElementById("inviteLinkOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "inviteLinkOverlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px";
    overlay.innerHTML = `
      <div style="background:var(--card,#1e1e1e);border:1px solid var(--border,#2e2e2e);border-radius:14px;padding:28px;max-width:520px;width:100%">
        <h3 style="margin-bottom:8px;font-size:15px">초대 링크 생성 완료</h3>
        <p style="font-size:12px;color:var(--muted);margin-bottom:14px">이 링크를 카카오톡·이메일로 학생에게 전달하세요. 72시간 유효합니다.</p>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <input id="inviteLinkVal" readonly style="flex:1;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:12px;font-family:monospace" value="">
          <button class="ghost-action micro" onclick="navigator.clipboard.writeText(document.getElementById('inviteLinkVal').value).then(()=>{this.textContent='복사됨!';setTimeout(()=>this.textContent='복사',1500)})">복사</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="ghost-action micro" onclick="document.getElementById('inviteLinkOverlay').remove()">닫기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  }
  document.getElementById("inviteLinkVal").value = inviteUrl;
  overlay.style.display = "flex";
}

async function regenInviteLink(userId) {
  const res = await apiFetch(`/api/admin/students/${userId}/invite-link`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) { alert(data.error || "초대 링크 생성 실패"); return; }
  showInviteLinkPopup(data.inviteUrl);
}

// ── Order → invite (결제 내역에서 초대) ──────────────────────
function openOrderInvite(email, name, orderNo) {
  const courses = state.courses || [];
  let overlay = document.getElementById("orderInviteOverlay");
  if (overlay) overlay.remove();
  overlay = document.createElement("div");
  overlay.id = "orderInviteOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px";
  overlay.innerHTML = `
    <div style="background:var(--card,#1e1e1e);border:1px solid var(--border,#2e2e2e);border-radius:14px;padding:28px;max-width:440px;width:100%">
      <h3 style="margin-bottom:6px;font-size:15px">초대 링크 생성</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px">${escHtml(name || email)} (${escHtml(email)})<br>어떤 강의실 접근 권한을 부여할까요?</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
        ${courses.map((c) => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <input type="checkbox" class="order-course-check" value="${escHtml(c.id)}" style="width:16px;height:16px;accent-color:var(--teal)">
            ${escHtml(c.room)} · ${escHtml(c.title)}
          </label>`).join("")}
        ${!courses.length ? "<p class='muted-text'>등록된 강의가 없습니다.</p>" : ""}
      </div>
      <div style="display:flex;gap:8px">
        <button class="primary-action micro" id="doOrderInviteBtn">초대 링크 생성</button>
        <button class="ghost-action micro" onclick="document.getElementById('orderInviteOverlay').remove()">취소</button>
      </div>
      <p id="orderInviteStatus" class="form-status" style="margin-top:8px"></p>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("doOrderInviteBtn").onclick = async () => {
    const courseIds = [...document.querySelectorAll(".order-course-check:checked")].map((el) => el.value);
    const statusEl = document.getElementById("orderInviteStatus");
    statusEl.textContent = "생성 중...";
    const res = await apiFetch("/api/admin/orders/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, orderNo, courseIds }),
    });
    const data = await res.json();
    if (!res.ok) { statusEl.textContent = data.error || "실패"; return; }
    overlay.remove();
    await loadState();
    showInviteLinkPopup(data.inviteUrl);
  };
}

async function resetPassword(userId) {
  const input = document.getElementById(`resetPwInput_${userId}`);
  const newPassword = input?.value?.trim() || "";
  if (!newPassword || newPassword.length < 8) { alert("새 비밀번호를 8자 이상 입력하세요."); return; }
  if (!confirm(`이 학생의 비밀번호를 초기화할까요?`)) return;
  const res = await apiFetch("/api/admin/users/reset-password", {
    method: "POST",
    body: JSON.stringify({ userId, newPassword }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "실패"); return; }
  alert("비밀번호가 초기화되었습니다.");
  if (input) input.value = "";
}

// ── Questions ─────────────────────────────────────────────────
function renderQuestions() {
  const list = document.getElementById("questionsList");
  const questions = state.allQuestions || [];
  if (!questions.length) {
    list.innerHTML = "<li class='empty-hint'>질문이 없습니다.</li>";
    return;
  }
  list.innerHTML = questions.map((q) => {
    const course = (state.courses || []).find((c) => c.id === q.courseId);
    const courseLabel = course ? `${course.room} · ${course.title}` : q.courseId;
    const answered = !!q.answer;
    return `<li class="queue-item">
      <div class="queue-header" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">
        <strong>${escHtml(q.studentName || "")}</strong>
        <span class="muted-text">${escHtml(q.studentEmail || "")}</span>
        <span class="pill">${escHtml(courseLabel)}</span>
        <span class="muted-text" style="font-size:12px">${q.createdAt ? new Date(q.createdAt).toLocaleString("ko-KR") : ""}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;
                     ${answered ? "background:#f0fdf4;color:#15803d" : "background:#fef9ee;color:#92400e"}">
          ${answered ? "답변 완료" : "대기 중"}</span>
      </div>
      <p class="queue-text" style="white-space:pre-wrap;word-break:break-word">${escHtml(q.content)}</p>
      ${answered ? `<div class="feedback-block" style="margin-top:10px">
        <strong style="font-size:12px;color:var(--teal)">답변 · ${q.answeredAt ? new Date(q.answeredAt).toLocaleString("ko-KR") : ""}</strong>
        <p style="white-space:pre-wrap;word-break:break-word;margin-top:4px">${escHtml(q.answer)}</p>
      </div>` : `<div class="feedback-form" style="margin-top:10px">
        <textarea id="qans_${q.id}" rows="3" class="feedback-input" placeholder="답변을 입력하세요..."></textarea>
        <button class="primary-action small" style="margin-top:6px" onclick="answerQuestion('${q.id}')">답변 등록</button>
      </div>`}
    </li>`;
  }).join("");
}

async function answerQuestion(questionId) {
  const el = document.getElementById(`qans_${questionId}`);
  const answer = (el?.value || "").trim();
  if (!answer) { alert("답변 내용을 입력하세요."); return; }
  const res = await apiFetch(`/api/admin/questions/${questionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "답변 등록 실패"); return; }
  state = await res.json();
  renderStats();
  renderQuestions();
}

// expose for inline onclick
window.openStudentModal = openStudentModal;
window.resendInvite = resendInvite;
window.revokeSession = revokeSession;
window.resetDevices = resetDevices;
window.resetPassword = resetPassword;
window.resetContract = resetContract;
window.sendFeedback = sendFeedback;
window.sendFeedbackFromQueue = sendFeedbackFromQueue;
window.deleteCourse = deleteCourse;
window.addChapter = addChapter;
window.deleteChapter = deleteChapter;
window.toggleStudentCourse = toggleStudentCourse;
window.saveImwebMapping = saveImwebMapping;
window.loadImwebOrders = loadImwebOrders;
window.loadImwebMembers = loadImwebMembers;
window.regenInviteLink = regenInviteLink;
window.openOrderInvite = openOrderInvite;
window.answerQuestion = answerQuestion;
window.deleteR2Video = deleteR2Video;
window.previewR2Video = previewR2Video;
window.closeVideoPreview = closeVideoPreview;
window.updateChapterAssignment = updateChapterAssignment;
window.adminDeletePost = adminDeletePost;
window.adminDeleteComment = adminDeleteComment;
window.adminAddComment = adminAddComment;

boot();
