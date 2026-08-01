let state = null;
const apiBaseUrl = normalizeApiBaseUrl(window.CARNIVAL_LION_API_URL || "");
const ui = {
  mode: "student",
  activeCourseId: "creator-ai",
  activeChapterId: "ai-01",
  selectedFileName: "",
};

let watermarkTimer = null;

const els = {
  courseNav: document.querySelector("#courseNav"),
  courseTitle: document.querySelector("#courseTitle"),
  miniName: document.querySelector("#miniName"),
  miniEmail: document.querySelector("#miniEmail"),
  gateBand: document.querySelector("#gateBand"),
  studentView: document.querySelector("#studentView"),
  adminView: document.querySelector("#adminView"),
  securityView: document.querySelector("#securityView"),
  studentViewBtn: document.querySelector("#studentViewBtn"),
  adminViewBtn: document.querySelector("#adminViewBtn"),
  securityViewBtn: document.querySelector("#securityViewBtn"),
  videoFrame: document.querySelector("#videoFrame"),
  courseArt: document.querySelector("#courseArt"),
  videoChapterLabel: document.querySelector("#videoChapterLabel"),
  videoTitle: document.querySelector("#videoTitle"),
  watchButton: document.querySelector("#watchButton"),
  watermark: document.querySelector("#watermark"),
  securityStatus: document.querySelector("#securityStatus"),
  progressLabel: document.querySelector("#progressLabel"),
  enrollmentLabel: document.querySelector("#enrollmentLabel"),
  assignmentTitle: document.querySelector("#assignmentTitle"),
  assignmentText: document.querySelector("#assignmentText"),
  assignmentFile: document.querySelector("#assignmentFile"),
  fileLabel: document.querySelector("#fileLabel"),
  submitAssignment: document.querySelector("#submitAssignment"),
  feedbackStatus: document.querySelector("#feedbackStatus"),
  feedbackList: document.querySelector("#feedbackList"),
  chapterCount: document.querySelector("#chapterCount"),
  chapterList: document.querySelector("#chapterList"),
  inviteRecord: document.querySelector("#inviteRecord"),
  resendInvite: document.querySelector("#resendInvite"),
  resetDemo: document.querySelector("#resetDemo"),
  ledger: document.querySelector("#ledger"),
  contractRecord: document.querySelector("#contractRecord"),
  resetContract: document.querySelector("#resetContract"),
  queueCount: document.querySelector("#queueCount"),
  adminQueue: document.querySelector("#adminQueue"),
  drmStatusGrid: document.querySelector("#drmStatusGrid"),
  playbackToken: document.querySelector("#playbackToken"),
  revokeSession: document.querySelector("#revokeSession"),
  simulateDevice: document.querySelector("#simulateDevice"),
  resetDevices: document.querySelector("#resetDevices"),
  deviceList: document.querySelector("#deviceList"),
  licenseLogCount: document.querySelector("#licenseLogCount"),
  licenseLog: document.querySelector("#licenseLog"),
  contractModal: document.querySelector("#contractModal"),
  signatureName: document.querySelector("#signatureName"),
  signatureEmail: document.querySelector("#signatureEmail"),
  signatureConfirm: document.querySelector("#signatureConfirm"),
  signContract: document.querySelector("#signContract"),
};

boot();

async function boot() {
  bindEvents();
  await refreshState();
  watermarkTimer = window.setInterval(positionWatermark, 2600);
  window.setInterval(refreshStateQuietly, 30000);
}

function bindEvents() {
  els.courseNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-course-id]");
    if (button) changeCourse(button.dataset.courseId);
  });

  els.chapterList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chapter-id]");
    if (button) changeChapter(button.dataset.chapterId);
  });

  els.adminQueue.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-feedback-id]");
    if (!button) return;
    await postAndRefresh("/api/admin/submissions/feedback", {
      submissionId: button.dataset.feedbackId,
      feedback: "검토 완료했습니다. 다음 챕터에서 반영 내용을 확인해 주세요.",
    });
  });

  els.studentViewBtn.addEventListener("click", () => switchMode("student"));
  els.adminViewBtn.addEventListener("click", () => switchMode("admin"));
  els.securityViewBtn.addEventListener("click", () => switchMode("security"));
  els.watchButton.addEventListener("click", watchOrComplete);
  els.submitAssignment.addEventListener("click", submitAssignment);
  els.signContract.addEventListener("click", signContract);
  els.resetContract.addEventListener("click", () => postAndRefresh("/api/contracts/reset"));
  els.resendInvite.addEventListener("click", () => postAndRefresh("/api/invitations/resend"));
  els.resetDemo.addEventListener("click", resetDemo);
  els.revokeSession.addEventListener("click", () => postAndRefresh("/api/drm/sessions/revoke"));
  els.simulateDevice.addEventListener("click", () => postAndRefresh("/api/drm/devices/simulate"));
  els.resetDevices.addEventListener("click", () => postAndRefresh("/api/drm/devices/reset"));
  els.assignmentFile.addEventListener("change", () => {
    ui.selectedFileName = els.assignmentFile.files[0]?.name || "";
    els.fileLabel.textContent = ui.selectedFileName || "자료 선택";
  });
  window.addEventListener("resize", positionWatermark);
}

async function refreshState() {
  try {
    state = await api("/api/state");
    normalizeActiveSelection();
    render();
  } catch (error) {
    renderFatalError(error);
  }
}

async function refreshStateQuietly() {
  if (!state) return;
  try {
    state = await api("/api/state");
    normalizeActiveSelection();
    render();
  } catch {
    // The visible app can keep the last known local state until the server returns.
  }
}

async function api(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(payload.error || "요청을 처리하지 못했습니다.");
    error.payload = payload;
    throw error;
  }

  return payload;
}

function buildApiUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${apiBaseUrl}${path}`;
}

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function postAndRefresh(path, body = {}) {
  try {
    state = await api(path, { method: "POST", body });
    normalizeActiveSelection();
    render();
  } catch (error) {
    if (error.payload?.state) {
      state = error.payload.state;
      normalizeActiveSelection();
      render();
    }
    window.alert(error.message);
  }
}

function normalizeActiveSelection() {
  const course = state.courses.find((item) => item.id === ui.activeCourseId) || state.courses[0];
  ui.activeCourseId = course.id;
  const chapter = course.chapters.find((item) => item.id === ui.activeChapterId) || course.chapters[0];
  ui.activeChapterId = chapter.id;
}

function render() {
  const course = getActiveCourse();
  const chapter = getActiveChapter();
  const unlocked = isUnlocked();

  els.miniName.textContent = state.user.name;
  els.miniEmail.textContent = state.user.email;
  document.querySelector(".status-dot").classList.toggle("is-active", unlocked);
  els.courseTitle.textContent = course.title;

  renderCourses();
  renderGate(unlocked);
  renderMode();
  renderStudent(course, chapter, unlocked);
  renderAdmin(course, unlocked);
  renderSecurity(course, chapter, unlocked);
  positionWatermark();
}

function renderFatalError(error) {
  els.gateBand.innerHTML = `
    <div>
      <p class="eyebrow">로컬 서버 필요</p>
      <h2>앱 서버에 연결하지 못했습니다.</h2>
      <p class="gate-summary">${escapeHtml(error.message)} 로컬 서버를 켠 뒤 다시 열어주세요.</p>
    </div>
  `;
}

function renderCourses() {
  els.courseNav.innerHTML = state.courses
    .map((course) => {
      const progress = courseProgress(course);
      const active = course.id === ui.activeCourseId ? " is-active" : "";
      return `
        <button class="course-button${active}" type="button" data-course-id="${escapeHtml(course.id)}">
          <strong>${escapeHtml(course.room)}</strong>
          <span>${escapeHtml(course.title)}</span>
          <div class="course-progress" aria-hidden="true"><i style="width:${progress}%"></i></div>
        </button>
      `;
    })
    .join("");
}

function renderGate(unlocked) {
  const stepClass = unlocked ? "done" : "warn";
  const title = unlocked ? "강의실 입장 가능" : "계약서 작성 후 강의실 입장";
  const summary = unlocked
    ? `${state.enrollment.buyerEmail} 계정으로 주문, 계약서, 수강권이 로컬 서버에 연결되었습니다.`
    : `주문번호 ${state.enrollment.orderNo}의 결제와 이메일 인증은 완료되었고, 계약서 서명이 남아 있습니다.`;
  const missingConnections = state.server.missingExternalConnections.join(" · ");

  els.gateBand.innerHTML = `
    <div>
      <p class="eyebrow">입장 게이트</p>
      <h2>${escapeHtml(title)}</h2>
      <div class="gate-steps">
        <span class="step-chip done">결제 확인</span>
        <span class="step-chip done">이메일 인증</span>
        <span class="step-chip ${stepClass}">계약서 서명</span>
        <span class="step-chip ${stepClass}">수강권 활성화</span>
        <span class="step-chip warn">외부 API 대기</span>
      </div>
      <p class="gate-summary">${escapeHtml(summary)}</p>
      <p class="gate-summary small">${escapeHtml(missingConnections)}</p>
    </div>
    <button class="primary-action" id="gateAction" type="button">${unlocked ? "계약 기록 보기" : "계약서 작성"}</button>
  `;

  document.querySelector("#gateAction").addEventListener("click", openContractModal);
}

function renderMode() {
  const student = ui.mode === "student";
  const admin = ui.mode === "admin";
  const security = ui.mode === "security";
  els.studentView.classList.toggle("is-hidden", !student);
  els.adminView.classList.toggle("is-hidden", !admin);
  els.securityView.classList.toggle("is-hidden", !security);
  els.studentViewBtn.classList.toggle("is-active", student);
  els.adminViewBtn.classList.toggle("is-active", admin);
  els.securityViewBtn.classList.toggle("is-active", security);
}

function renderStudent(course, chapter, unlocked) {
  const progress = courseProgress(course);
  const chapterProgress = getProgress(course.id, chapter.id);
  const submissions = activeSubmissions();
  const activeSession = getActiveSession();
  const sessionMatchesChapter = activeSession?.chapterId === chapter.id;

  els.courseArt.className = `course-art ${course.artClass}`;
  els.videoChapterLabel.textContent = `${chapter.label} · ${chapter.duration}`;
  els.videoTitle.textContent = chapter.title;
  els.watermark.textContent = `${state.user.name} · ${state.user.email} · ${state.user.memberId}`;
  els.securityStatus.textContent = unlocked ? (sessionMatchesChapter ? "DRM 세션 활성" : "재생 토큰 대기") : "계약서 대기";
  els.progressLabel.textContent = `${progress}%`;
  els.enrollmentLabel.textContent = unlocked ? "활성" : "대기";
  els.watchButton.textContent = getWatchButtonLabel(chapterProgress, sessionMatchesChapter, unlocked);
  els.assignmentTitle.textContent = `${chapter.label} 과제 제출`;
  els.submitAssignment.disabled = !unlocked;
  els.assignmentText.disabled = !unlocked;
  els.assignmentFile.disabled = !unlocked;
  els.fileLabel.textContent = ui.selectedFileName || "자료 선택";
  els.feedbackStatus.textContent = submissions.length ? `${submissions.length}건` : "피드백 없음";
  els.feedbackStatus.className = submissions.some((item) => item.status === "feedback_sent") ? "pill positive" : submissions.length ? "pill warn" : "pill";
  els.chapterCount.textContent = `${course.chapters.length}개`;

  els.feedbackList.innerHTML = submissions.length
    ? submissions
        .map(
          (submission) => `
          <div class="feedback-item">
            <strong>${escapeHtml(submission.chapterLabel)} 제출</strong>
            <span>${escapeHtml(submission.createdAt)}${submission.fileName ? ` · ${escapeHtml(submission.fileName)}` : ""}</span>
            <p>${escapeHtml(submission.text)}</p>
            ${
              submission.feedback
                ? `<div class="feedback-note"><strong>운영자 피드백</strong><p>${escapeHtml(submission.feedback)}</p></div>`
                : `<span class="pill warn">피드백 대기</span>`
            }
          </div>
        `,
        )
        .join("")
    : `<div class="feedback-item"><strong>아직 제출된 과제가 없습니다.</strong><p>계약서 서명 후 챕터별 과제를 제출할 수 있습니다.</p></div>`;

  els.chapterList.innerHTML = course.chapters
    .map((item) => {
      const itemProgress = getProgress(course.id, item.id);
      const active = item.id === chapter.id ? " is-active" : "";
      const locked = unlocked ? "" : " is-locked";
      const doneLabel = itemProgress >= 100 ? "완료" : `${itemProgress}%`;
      return `
        <button class="chapter-item${active}${locked}" type="button" data-chapter-id="${escapeHtml(item.id)}">
          <div class="chapter-title-row">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="pill ${itemProgress >= 100 ? "positive" : ""}">${doneLabel}</span>
          </div>
          <div class="chapter-meta">${escapeHtml(item.label)} · ${escapeHtml(item.duration)}</div>
          <div class="tiny-progress" aria-hidden="true"><i style="width:${itemProgress}%"></i></div>
          <div class="chapter-resource">
            <span>${escapeHtml(item.material)}</span>
            <span>${unlocked ? "열람 가능" : "잠김"}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderAdmin(course, unlocked) {
  const progress = courseProgress(course);
  const contract = state.contract;
  const submissions = state.submissions.filter((submission) => submission.courseId === course.id);
  const invite = state.latestInvite;
  const latestMail = state.mailOutbox[0];

  els.inviteRecord.innerHTML = invite
    ? `
      <div class="contract-row">
        <span>수신 이메일</span>
        <strong>${escapeHtml(invite.email)}</strong>
      </div>
      <div class="contract-row">
        <span>초대 상태</span>
        <strong>${escapeHtml(invite.status)}</strong>
      </div>
      <div class="contract-row">
        <span>발송 시각</span>
        <strong>${escapeHtml(invite.sentAt)}</strong>
      </div>
      <div class="contract-row">
        <span>만료 시각</span>
        <strong>${formatExpiry(invite.expiresAt)}</strong>
      </div>
      <div class="contract-row">
        <span>토큰 해시</span>
        <strong>${escapeHtml(invite.tokenHash.slice(0, 28))}...</strong>
      </div>
      <div class="mail-preview">
        <strong>로컬 발송함</strong>
        <span>${latestMail ? `${escapeHtml(latestMail.subject)} · ${escapeHtml(latestMail.createdAt)}` : "발송 기록 없음"}</span>
      </div>
    `
    : `<div class="contract-row"><span>상태</span><strong>초대 없음</strong></div>`;

  els.ledger.innerHTML = `
    <div class="ledger-row">
      <span>주문번호</span>
      <strong>${escapeHtml(state.enrollment.orderNo)}</strong>
    </div>
    <div class="ledger-row">
      <span>상품 ID</span>
      <strong>${escapeHtml(course.productId)}</strong>
    </div>
    <div class="ledger-row">
      <span>구매자</span>
      <strong>${escapeHtml(state.enrollment.buyerName)}</strong>
    </div>
    <div class="ledger-row">
      <span>주문 이메일</span>
      <strong>${escapeHtml(state.enrollment.buyerEmail)}</strong>
    </div>
    <div class="ledger-row">
      <span>결제 시각</span>
      <strong>${escapeHtml(state.enrollment.paidAt)}</strong>
    </div>
    <div class="ledger-row">
      <span>수강 상태</span>
      <strong>${escapeHtml(state.enrollment.status)}</strong>
    </div>
    <div class="ledger-row">
      <span>진도율</span>
      <strong>${progress}%</strong>
    </div>
  `;

  els.contractRecord.innerHTML = contract
    ? `
      <div class="contract-row">
        <span>문서 버전</span>
        <strong>${escapeHtml(contract.version)}</strong>
      </div>
      <div class="contract-row">
        <span>서명자</span>
        <strong>${escapeHtml(contract.name)}</strong>
      </div>
      <div class="contract-row">
        <span>서명 이메일</span>
        <strong>${escapeHtml(contract.email)}</strong>
      </div>
      <div class="contract-row">
        <span>서명 시각</span>
        <strong>${escapeHtml(contract.signedAt)}</strong>
      </div>
      <div class="contract-row">
        <span>문서 해시</span>
        <strong>${escapeHtml(contract.documentHash.slice(0, 32))}...</strong>
      </div>
    `
    : `
      <div class="contract-row">
        <span>상태</span>
        <strong>미서명</strong>
      </div>
      <div class="contract-row">
        <span>입장 처리</span>
        <strong>${unlocked ? "활성" : "대기"}</strong>
      </div>
    `;

  els.queueCount.textContent = `${submissions.length}건`;
  els.adminQueue.innerHTML = submissions.length
    ? submissions
        .map(
          (submission) => `
          <div class="queue-item">
            <div class="queue-top">
              <strong>${escapeHtml(submission.chapterLabel)} · ${escapeHtml(submission.chapterTitle)}</strong>
              <span class="pill ${submission.status === "feedback_sent" ? "positive" : "warn"}">${submission.status === "feedback_sent" ? "피드백 완료" : "검토 대기"}</span>
            </div>
            <span>${escapeHtml(submission.studentName)} · ${escapeHtml(submission.studentEmail)} · ${escapeHtml(submission.createdAt)}</span>
            <p>${escapeHtml(submission.text)}</p>
            ${
              submission.feedback
                ? `<div class="feedback-note"><strong>피드백</strong><p>${escapeHtml(submission.feedback)}</p></div>`
                : `<button class="ghost-action inline-action" data-feedback-id="${escapeHtml(submission.id)}" type="button">샘플 피드백 남기기</button>`
            }
          </div>
        `,
        )
        .join("")
    : `<div class="queue-item"><strong>검토할 과제가 없습니다.</strong><p>학생이 과제를 제출하면 이곳에 쌓입니다.</p></div>`;
}

function renderSecurity(course, chapter, unlocked) {
  const activeSession = getActiveSession();
  const policy = state.drm.policy;
  const deviceCount = state.drm.devices.length;
  const deviceLimitOk = deviceCount <= policy.maxDevices;
  const tokenReady = Boolean(activeSession);
  const watermarkLabel = policy.watermarkMode === "dynamic_visible" ? "동적 노출" : "고정 노출";

  const cards = [
    {
      title: "멀티 DRM",
      value: course.videoAsset.keySystems.join(" · "),
      detail: `${course.videoAsset.packaging} 패키징 기준`,
      meter: 82,
      tone: "positive",
    },
    {
      title: "서명 재생 URL",
      value: tokenReady ? `${policy.tokenTtlMinutes}분 토큰 발급됨` : `${policy.tokenTtlMinutes}분 만료 정책`,
      detail: tokenReady ? "로컬 서버가 재생 세션을 승인했습니다." : "재생 시작 시 서버가 짧은 토큰을 발급합니다.",
      meter: tokenReady ? 92 : 58,
      tone: tokenReady ? "positive" : "warn",
    },
    {
      title: "기기 제한",
      value: `${deviceCount}/${policy.maxDevices}대 등록`,
      detail: deviceLimitOk ? "허용 범위 안에 있습니다." : "등록 기기 수가 정책을 초과했습니다.",
      meter: Math.min(100, Math.round((deviceCount / policy.maxDevices) * 100)),
      tone: deviceLimitOk ? "positive" : "danger",
    },
    {
      title: "워터마크",
      value: watermarkLabel,
      detail: `${state.user.name}, 이메일, 회원 ID가 재생 중 이동 표시됩니다.`,
      meter: unlocked ? 88 : 36,
      tone: unlocked ? "positive" : "warn",
    },
  ];

  els.drmStatusGrid.innerHTML = cards
    .map(
      (card) => `
      <div class="security-card">
        <span>${escapeHtml(card.title)}</span>
        <strong>${escapeHtml(card.value)}</strong>
        <div class="security-meter" aria-hidden="true"><i style="width:${card.meter}%"></i></div>
        <span class="pill ${card.tone}">${escapeHtml(card.detail)}</span>
      </div>
    `,
    )
    .join("");

  els.revokeSession.disabled = !activeSession;
  els.playbackToken.innerHTML = activeSession
    ? `
      <div class="token-line">
        <strong>${escapeHtml(activeSession.chapterLabel)} · ${escapeHtml(activeSession.chapterTitle)}</strong>
        <span class="pill positive">활성</span>
      </div>
      <span>${escapeHtml(activeSession.deviceLabel)} · ${escapeHtml(activeSession.issuedAt)} 발급 · ${formatExpiry(activeSession.expiresAt)} 만료</span>
      <code class="token-code">{
  "assetId": "${escapeHtml(activeSession.assetId)}",
  "manifest": "${escapeHtml(activeSession.manifestUrl)}",
  "licenseServer": "${escapeHtml(activeSession.licenseUrl)}",
  "tokenHash": "${escapeHtml(activeSession.tokenHash.slice(0, 32))}..."
}</code>
    `
    : `
      <strong>활성 재생 세션이 없습니다.</strong>
      <span>학생 화면에서 계약서 서명 후 보안 재생을 시작하면 이곳에 재생 토큰과 라이선스 요청 기록이 표시됩니다.</span>
    `;

  els.deviceList.innerHTML = state.drm.devices
    .map((device, index) => {
      const overLimit = index + 1 > policy.maxDevices;
      const active = activeSession?.deviceId === device.id;
      return `
        <div class="device-item">
          <div class="device-top">
            <strong>${escapeHtml(device.label)}</strong>
            <span class="pill ${overLimit ? "danger" : active ? "positive" : ""}">${overLimit ? "초과" : active ? "재생 중" : "등록"}</span>
          </div>
          <span>${device.trusted ? "신뢰 기기" : "검토 필요"} · 마지막 접속 ${escapeHtml(device.lastSeen)}</span>
        </div>
      `;
    })
    .join("");

  els.licenseLogCount.textContent = `${state.drm.licenseLog.length}건`;
  els.licenseLog.innerHTML = state.drm.licenseLog.length
    ? state.drm.licenseLog
        .map(
          (event) => `
          <div class="license-item">
            <div class="license-top">
              <strong>${escapeHtml(event.title)}</strong>
              <span class="pill ${event.status === "blocked" ? "danger" : event.status === "ended" ? "" : "positive"}">${escapeHtml(event.statusLabel)}</span>
            </div>
            <span>${escapeHtml(event.createdAt)} · ${escapeHtml(event.detail)}</span>
          </div>
        `,
        )
        .join("")
    : `
      <div class="license-item">
        <strong>아직 보안 로그가 없습니다.</strong>
        <span>재생 요청, 기기 초과, 세션 종료 같은 이벤트가 이곳에 남습니다.</span>
      </div>
    `;
}

function getWatchButtonLabel(chapterProgress, sessionMatchesChapter, unlocked) {
  if (!unlocked) return "계약서 작성";
  if (chapterProgress > 0 && chapterProgress < 100) return sessionMatchesChapter ? "챕터 완료" : "챕터 완료";
  if (chapterProgress >= 100) return sessionMatchesChapter ? "재생 중" : "다시 재생";
  return "보안 재생 시작";
}

function openContractModal() {
  els.signatureName.value = state.contract?.name || state.user.name;
  els.signatureEmail.value = state.contract?.email || state.user.email;
  els.signatureConfirm.checked = Boolean(state.contract);
  els.contractModal.showModal();
}

async function signContract() {
  await postAndRefresh("/api/contracts/sign", {
    name: els.signatureName.value.trim(),
    email: els.signatureEmail.value.trim(),
    confirmed: els.signatureConfirm.checked,
  });
  if (isUnlocked()) els.contractModal.close();
}

function changeCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  ui.activeCourseId = course.id;
  ui.activeChapterId = course.chapters[0].id;
  render();
}

function changeChapter(chapterId) {
  if (!isUnlocked()) {
    openContractModal();
    return;
  }

  const course = getActiveCourse();
  if (!course.chapters.some((chapter) => chapter.id === chapterId)) return;
  ui.activeChapterId = chapterId;
  render();
}

function switchMode(mode) {
  ui.mode = mode;
  render();
}

async function watchOrComplete() {
  if (!isUnlocked()) {
    openContractModal();
    return;
  }

  const course = getActiveCourse();
  const chapter = getActiveChapter();
  const current = getProgress(course.id, chapter.id);

  if (current > 0 && current < 100) {
    await postAndRefresh("/api/progress/complete", {
      courseId: course.id,
      chapterId: chapter.id,
    });
    return;
  }

  await postAndRefresh("/api/playback/sessions", {
    courseId: course.id,
    chapterId: chapter.id,
  });
}

async function submitAssignment() {
  if (!isUnlocked()) {
    openContractModal();
    return;
  }

  const text = els.assignmentText.value.trim();
  if (!text) {
    window.alert("피드백 받을 내용을 입력해 주세요.");
    return;
  }

  await postAndRefresh("/api/submissions", {
    courseId: getActiveCourse().id,
    chapterId: getActiveChapter().id,
    text,
    fileName: ui.selectedFileName,
  });

  els.assignmentText.value = "";
  els.assignmentFile.value = "";
  ui.selectedFileName = "";
  els.fileLabel.textContent = "자료 선택";
}

async function resetDemo() {
  const ok = window.confirm("로컬 데이터를 처음 상태로 되돌릴까요?");
  if (!ok) return;
  state = await api("/api/demo/reset", { method: "POST", body: {} });
  ui.mode = "student";
  ui.activeCourseId = "creator-ai";
  ui.activeChapterId = "ai-01";
  ui.selectedFileName = "";
  els.assignmentText.value = "";
  render();
}

function getActiveCourse() {
  return state.courses.find((course) => course.id === ui.activeCourseId) || state.courses[0];
}

function getActiveChapter() {
  const course = getActiveCourse();
  return course.chapters.find((chapter) => chapter.id === ui.activeChapterId) || course.chapters[0];
}

function isUnlocked() {
  return state.enrollment.emailVerified && state.enrollment.contractSigned && state.enrollment.status === "active";
}

function getProgress(courseId, chapterId) {
  return state.progress[`${state.user.id}:${courseId}:${chapterId}`] || 0;
}

function courseProgress(course) {
  const total = course.chapters.reduce((sum, chapter) => sum + getProgress(course.id, chapter.id), 0);
  return Math.round(total / course.chapters.length);
}

function activeSubmissions() {
  return state.submissions.filter(
    (submission) => submission.courseId === ui.activeCourseId && submission.chapterId === ui.activeChapterId,
  );
}

function getActiveSession() {
  const session = state.drm.activeSession;
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return session;
}

function positionWatermark() {
  if (!state) return;
  const frame = els.videoFrame.getBoundingClientRect();
  const xMax = Math.max(20, frame.width - 430);
  const yMax = Math.max(20, frame.height - 70);
  const x = Math.round(16 + Math.random() * (xMax - 16));
  const y = Math.round(16 + Math.random() * (yMax - 16));
  els.watermark.style.setProperty("--wm-x", `${x}px`);
  els.watermark.style.setProperty("--wm-y", `${y}px`);
}

function formatExpiry(expiresAt) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(expiresAt));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}
