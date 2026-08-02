const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const { createHash, randomUUID, randomBytes, pbkdf2Sync } = require("crypto");
const { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { createClient } = require("@supabase/supabase-js");
// nodemailer removed — Railway blocks SMTP; using Gmail REST API (HTTPS) instead

// ── Environment ─────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const IMWEB_WEBHOOK_SECRET = process.env.IMWEB_WEBHOOK_SECRET || "";
const IMWEB_SITE_CODE = process.env.IMWEB_SITE_CODE || "";
const IMWEB_API_KEY = process.env.IMWEB_API_KEY || "";
const IMWEB_SECRET_KEY = process.env.IMWEB_SECRET_KEY || "";
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || "";
const GMAIL_FROM = process.env.GMAIL_FROM || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "carnival-lion-admin-2026";

const port = Number(process.env.PORT || 8941);
const bindHost = process.env.BIND_HOST || (process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1");
const appUrl = (process.env.APP_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const apiUrl = (process.env.API_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const isProduction = !!(process.env.RAILWAY_ENVIRONMENT);

const allowedOrigins = new Set(
  [appUrl, apiUrl, `http://127.0.0.1:${port}`, `http://localhost:${port}`,
   ...(process.env.CORS_ORIGINS || "").split(",")]
    .map((o) => o.trim()).filter(Boolean),
);

// ── Mail (Gmail REST API via HTTPS — SMTP is blocked on Railway) ──────────────
const mailReady = !!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN && GMAIL_FROM);

function fetchWithTimeout(url, opts, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function getGmailAccessToken() {
  console.log(`[mail] fetching OAuth token... client=${GMAIL_CLIENT_ID.slice(0,10)} rt=${GMAIL_REFRESH_TOKEN.slice(0,12)}`);
  const resp = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const text = await resp.text();
  console.log(`[mail] OAuth token response ${resp.status}: ${text.slice(0, 300)}`);
  if (!resp.ok) throw new Error(`OAuth token error ${resp.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  console.log("[mail] OAuth token OK");
  return data.access_token;
}

async function sendMail(to, subject, html) {
  if (!mailReady) { console.log("[mail] skipped: credentials not configured"); return { skipped: true }; }
  console.log(`[mail] sending to ${to}: ${subject}`);
  const accessToken = await getGmailAccessToken();
  const b64Subject = Buffer.from(subject).toString("base64");
  const fromName = Buffer.from("카니발 라이언 LMS").toString("base64");
  const rawMessage = [
    `From: =?UTF-8?B?${fromName}?= <${GMAIL_FROM}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64Subject}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    html,
  ].join("\r\n");
  const raw = Buffer.from(rawMessage).toString("base64url");
  console.log("[mail] calling Gmail API send...");
  const resp = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Gmail API error: ${JSON.stringify(data.error || data)}`);
  console.log(`[mail] sent to ${to}, id=${data.id}`);
  return { sent: true, to, messageId: data.id };
}

async function sendInviteMail(to, inviteUrl) {
  return sendMail(to, "[카니발 라이언 LMS] 강의실 초대 링크",
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a;margin-bottom:8px">강의실 초대 링크</h2>
      <p style="color:#374151">결제해 주셔서 감사합니다. 아래 링크를 클릭하면 강의실에 입장할 수 있습니다.</p>
      <p style="margin:28px 0">
        <a href="${inviteUrl}" style="background:#137a70;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">강의실 입장하기</a>
      </p>
      <p style="color:#6b7280;font-size:13px">링크는 72시간 후 만료됩니다.</p>
    </div>`);
}

async function sendMagicLinkMail(to, loginUrl) {
  return sendMail(to, "[카니발 라이언 LMS] 로그인 링크",
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a;margin-bottom:8px">로그인 링크</h2>
      <p style="color:#374151">아래 링크를 클릭하면 강의실에 바로 로그인됩니다.</p>
      <p style="margin:28px 0">
        <a href="${loginUrl}" style="background:#137a70;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">로그인하기</a>
      </p>
      <p style="color:#6b7280;font-size:13px">링크는 30분 후 만료됩니다. 요청하지 않았다면 무시해 주세요.</p>
    </div>`);
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// ── R2 ────────────────────────────────────────────────────────────────────────
const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "lms-videos";
const R2_PLAYBACK_TTL = Number(process.env.R2_PLAYBACK_TTL_SECONDS || 3600);

const r2 = R2_ENDPOINT && R2_ACCESS_KEY_ID
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

async function generateR2PlaybackUrl(courseId, chapterId) {
  if (!r2) return null;
  try {
    const key = `videos/${courseId}/${chapterId}/video.mp4`;
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: R2_PLAYBACK_TTL });
  } catch { return null; }
}

async function generateR2UploadUrl(courseId, chapterId, contentType) {
  if (!r2) throw new Error("R2 미연결");
  const key = `videos/${courseId}/${chapterId}/video.mp4`;
  return {
    uploadUrl: await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType || "video/mp4" }), { expiresIn: 3600 }),
    key,
    bucket: R2_BUCKET,
  };
}

// ── Courses ───────────────────────────────────────────────────────────────────
const courses = [
  {
    id: "creator-ai", productId: "COURSE-AI-01",
    videoAsset: { assetId: "vod-ai-001", manifestUrl: "https://cdn.example.com/vod-ai/manifest.mpd", packaging: "CENC + HLS FairPlay", keySystems: ["Widevine", "FairPlay", "PlayReady"] },
    title: "AI 콘텐츠 제작 마스터", room: "1강의실", subtitle: "기획부터 자동화까지", artClass: "",
    chapters: [
      { id: "ai-01", label: "Chapter 1", title: "강의실 세팅과 학습 루틴", duration: "18분", material: "온보딩 체크리스트.pdf" },
      { id: "ai-02", label: "Chapter 2", title: "콘텐츠 기획 프레임 만들기", duration: "27분", material: "기획 템플릿.xlsx" },
      { id: "ai-03", label: "Chapter 3", title: "제작 자동화 워크플로우", duration: "34분", material: "자동화 플로우.pdf" },
    ],
  },
  {
    id: "design-system", productId: "COURSE-DS-02",
    videoAsset: { assetId: "vod-ds-002", manifestUrl: "https://cdn.example.com/vod-ds/manifest.mpd", packaging: "CENC + HLS FairPlay", keySystems: ["Widevine", "FairPlay", "PlayReady"] },
    title: "브랜드 디자인 시스템", room: "2강의실", subtitle: "반복 가능한 디자인 운영", artClass: "design",
    chapters: [
      { id: "ds-01", label: "Chapter 1", title: "브랜드 톤과 UI 원칙", duration: "22분", material: "브랜드 원칙.pdf" },
      { id: "ds-02", label: "Chapter 2", title: "컴포넌트와 템플릿 정리", duration: "31분", material: "컴포넌트 보드.fig" },
      { id: "ds-03", label: "Chapter 3", title: "검수 기준과 배포 루틴", duration: "25분", material: "검수 체크리스트.pdf" },
    ],
  },
  {
    id: "feedback-lab", productId: "COURSE-FB-03",
    videoAsset: { assetId: "vod-fb-003", manifestUrl: "https://cdn.example.com/vod-fb/manifest.mpd", packaging: "CENC + HLS FairPlay", keySystems: ["Widevine", "FairPlay", "PlayReady"] },
    title: "1:1 피드백 랩", room: "3강의실", subtitle: "과제 중심 실전 코칭", artClass: "feedback",
    chapters: [
      { id: "fb-01", label: "Chapter 1", title: "진단 과제 제출", duration: "14분", material: "진단 과제 안내.pdf" },
      { id: "fb-02", label: "Chapter 2", title: "피드백 반영과 재제출", duration: "20분", material: "피드백 반영표.docx" },
      { id: "fb-03", label: "Chapter 3", title: "최종 리뷰와 다음 액션", duration: "19분", material: "최종 리뷰 노트.pdf" },
    ],
  },
];

// ── Cookie / Session ──────────────────────────────────────────────────────────
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;   // 30 days
const ADMIN_TTL   = 24 * 60 * 60 * 1000;          // 1 day
const MAGIC_TTL   = 30 * 60 * 1000;               // 30 min

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function cookieDomain() {
  if (!isProduction) return "";
  try {
    const host = new URL(appUrl).hostname;
    const parts = host.split(".");
    if (parts.length >= 2) return `; Domain=.${parts.slice(-2).join(".")}`;
  } catch {}
  return "";
}

function makeSessionCookie(name, token, maxAgeSec) {
  let cookie = `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  if (isProduction) cookie += "; Secure";
  const domain = cookieDomain();
  if (domain) cookie += domain;
  return cookie;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly`;
}

function sha256hex(v) {
  return createHash("sha256").update(String(v)).digest("hex");
}

function tokenHash(token) {
  return sha256hex(token);
}

function getStudentSession(req, db) {
  const token = parseCookies(req.headers.cookie).clms_session;
  if (!token) return null;
  const session = db.sessions?.[tokenHash(token)];
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return session;
}

function getAdminSession(req, db) {
  const token = parseCookies(req.headers.cookie).clms_admin;
  if (!token) return null;
  const session = db.adminSessions?.[tokenHash(token)];
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return session;
}

function requireStudent(req, db) {
  const session = getStudentSession(req, db);
  if (!session) throw httpError(401, "로그인이 필요합니다.");
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) throw httpError(401, "사용자를 찾을 수 없습니다.");
  const enrollment = db.enrollments.find((e) => e.userId === user.id);
  return { user, session, enrollment: enrollment || null };
}

function requireAdmin(req, db) {
  if (!getAdminSession(req, db)) throw httpError(401, "관리자 로그인이 필요합니다.");
}

// ── DB ────────────────────────────────────────────────────────────────────────
function defaultDb() {
  return {
    schemaVersion: 2,
    courses,
    users: [],
    enrollments: [],
    invitations: [],
    mailOutbox: [],
    contractSignatures: [],
    progress: {},
    submissions: [],
    board: {},
    questions: [],
    drm: {
      policy: { tokenTtlMinutes: 10, maxDevices: 3, maxConcurrentStreams: 1, watermarkMode: "dynamic_visible", captureResponse: "block_if_supported" },
      devices: {},
      activeSessions: {},
      licenseLog: [],
      deviceRemovalLog: {},
    },
    sessions: {},
    adminSessions: {},
  };
}

function migrateDb(db) {
  if (!db.courses || !db.courses.length) db.courses = courses;
  // always enforce latest policy minimums
  if (db.drm?.policy) {
    if ((db.drm.policy.maxDevices || 0) < 3) db.drm.policy.maxDevices = 3;
    if (!db.drm.deviceRemovalLog) db.drm.deviceRemovalLog = {};
  }
  if (!db.board) db.board = {};
  if (!db.questions) db.questions = [];
  if ((db.schemaVersion || 1) >= 2) return db;
  // v1 → v2
  if (db.user && !db.users) { db.users = [db.user]; delete db.user; }
  if (db.enrollment && !db.enrollments) { db.enrollments = [db.enrollment]; delete db.enrollment; }
  const userId = db.users?.[0]?.id;
  if (userId && db.drm) {
    if (Array.isArray(db.drm.devices)) {
      db.drm.devices = { [userId]: db.drm.devices };
    }
    if (!db.drm.activeSessions) {
      db.drm.activeSessions = db.drm.activeSession ? { [userId]: db.drm.activeSession } : {};
      delete db.drm.activeSession;
    }
  }
  // add invite userId if missing
  if (Array.isArray(db.invitations)) {
    for (const inv of db.invitations) {
      if (!inv.userId && userId) inv.userId = userId;
      if (!inv.inviteUrl && inv.localInviteUrl) inv.inviteUrl = inv.localInviteUrl;
    }
  }
  db.sessions = db.sessions || {};
  db.adminSessions = db.adminSessions || {};
  db.schemaVersion = 2;
  return db;
}

async function readDb() {
  if (supabase) {
    const { data, error } = await supabase.from("lms_state").select("data").eq("id", "main").maybeSingle();
    if (!error && data) return migrateDb(data.data);
    if (!error && !data) { const f = defaultDb(); await writeDb(f); return f; }
    throw new Error(`DB read failed: ${error.message}`);
  }
  const dbPath = path.join(__dirname, "data", "db.json");
  if (!fs.existsSync(dbPath)) { const f = defaultDb(); await writeDb(f); return f; }
  return migrateDb(JSON.parse(fs.readFileSync(dbPath, "utf8")));
}

async function writeDb(db) {
  if (supabase) {
    const { error } = await supabase.from("lms_state").upsert({ id: "main", data: db, updated_at: new Date().toISOString() });
    if (error) throw new Error(`DB write failed: ${error.message}`);
    return;
  }
  const dir = path.join(__dirname, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify(db, null, 2) + "\n", "utf8");
}

async function updateDb(mutator) {
  const db = await readDb();
  pruneExpired(db);
  const result = await mutator(db);
  await writeDb(db);
  return result ?? db;
}

function pruneExpired(db) {
  const now = Date.now();
  for (const [h, s] of Object.entries(db.sessions || {})) {
    if (new Date(s.expiresAt).getTime() <= now) delete db.sessions[h];
  }
  for (const [h, s] of Object.entries(db.adminSessions || {})) {
    if (new Date(s.expiresAt).getTime() <= now) delete db.adminSessions[h];
  }
  for (const [uid, s] of Object.entries(db.drm?.activeSessions || {})) {
    if (s && new Date(s.expiresAt).getTime() <= now) {
      addLicenseLog(db, "session_expired", "ended", `${s.chapterLabel} 재생 세션 만료`, uid);
      delete db.drm.activeSessions[uid];
    }
  }
}

// ── State projections ─────────────────────────────────────────────────────────
async function toClientState(db, userId, currentDeviceId = null) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { error: "사용자 없음" };
  const enrollment = db.enrollments.find((e) => e.userId === user.id);
  const latestContract = db.contractSignatures.filter((c) => c.userId === user.id)[0] || null;
  const latestInvite = db.invitations.filter((i) => i.userId === user.id)[0] || null;
  const userDevices = db.drm.devices?.[user.id] || [];
  const rawSession = db.drm.activeSessions?.[user.id] || null;
  let activeSession = rawSession && new Date(rawSession.expiresAt).getTime() > Date.now() ? rawSession : null;
  if (activeSession && r2) {
    const freshUrl = await generateR2PlaybackUrl(activeSession.courseId, activeSession.chapterId).catch(() => null);
    if (freshUrl) activeSession = { ...activeSession, manifestUrl: freshUrl };
  }
  const enrolledIds = enrollment?.courseIds || [];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const removalLog = db.drm.deviceRemovalLog?.[user.id] || [];
  const removalsThisMonth = removalLog.filter((r) => r.removedAt.startsWith(thisMonth)).length;

  return {
    courses: db.courses.filter((c) => enrolledIds.includes(c.id)),
    user,
    enrollment: enrollment || null,
    contract: latestContract,
    progress: db.progress,
    submissions: db.submissions.filter((s) => s.userId === user.id),
    drm: {
      policy: db.drm.policy,
      devices: userDevices,
      currentDeviceId,
      deviceRemovalsThisMonth: removalsThisMonth,
      deviceRemovalLimit: 2,
      activeSession,
      licenseLog: db.drm.licenseLog.filter((l) => !l.userId || l.userId === user.id).slice(0, 20),
    },
    questions: (db.questions || []).filter((q) => q.userId === user.id),
    accessExpiresAt: enrollment?.accessExpiresAt || null,
    invitations: db.invitations.filter((i) => i.userId === user.id),
    latestInvite,
    mailOutbox: db.mailOutbox.filter((m) => m.to === user.email).slice(0, 5),
    server: {
      mode: r2 ? "r2-connected" : "api-connected",
      r2Connected: !!r2,
      r2Bucket: R2_BUCKET,
      missingExternalConnections: [
        ...(supabase ? [] : ["Supabase DB"]),
        ...(r2 ? [] : ["Cloudflare R2"]),
        ...(mailReady ? [] : ["Gmail 메일"]),
      ],
    },
  };
}

function toAdminState(db) {
  const students = db.users.map((user) => {
    const enrollment = db.enrollments.find((e) => e.userId === user.id);
    const latestContract = db.contractSignatures.filter((c) => c.userId === user.id)[0] || null;
    const submissions = db.submissions.filter((s) => s.userId === user.id);
    const enrolledIds = enrollment?.courseIds || [];
    const enrolledCourses = db.courses.filter((c) => enrolledIds.includes(c.id)).map((c) => {
      const total = c.chapters.length;
      const done = c.chapters.filter((ch) => (db.progress[`${user.id}:${c.id}:${ch.id}`] || 0) >= 100).length;
      return { id: c.id, title: c.title, room: c.room, progress: total ? Math.round((done / total) * 100) : 0 };
    });
    const latestInvite = db.invitations.filter((i) => i.userId === user.id && i.status === "sent")[0] || null;
    return {
      user,
      enrollment: enrollment || null,
      contract: latestContract,
      courses: enrolledCourses,
      submissionCount: submissions.length,
      pendingFeedback: submissions.filter((s) => s.status === "feedback_requested").length,
      activeSession: db.drm.activeSessions?.[user.id] || null,
      devices: db.drm.devices?.[user.id] || [],
      latestInvite,
    };
  });

  return {
    courses: db.courses,
    students,
    pendingSubmissions: db.submissions.filter((s) => s.status === "feedback_requested"),
    recentSubmissions: db.submissions.slice(0, 50),
    invitations: db.invitations.slice(0, 30),
    mailOutbox: db.mailOutbox.slice(0, 20),
    drm: { policy: db.drm.policy, licenseLog: db.drm.licenseLog.slice(0, 50) },
    r2: { connected: !!r2, bucket: R2_BUCKET },
    server: { supabaseConnected: !!supabase, r2Connected: !!r2, mailerConnected: mailReady },
    pendingQuestions: (db.questions || []).filter((q) => !q.answer).slice(0, 100),
    allQuestions: (db.questions || []).slice(0, 200),
  };
}

// ── Invite helpers ────────────────────────────────────────────────────────────
function createInviteRecord(email, userId, reason, ttl = 72 * 60 * 60 * 1000) {
  const token = `invite_${randomBytes(24).toString("hex")}`;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const inviteUrl = `${apiUrl}/invite/${token}`;
  return {
    publicRecord: {
      id: `inv_${randomUUID()}`, userId, email,
      tokenHash: sha256hex(token),
      tokenPreview: `${token.slice(0, 14)}...${token.slice(-6)}`,
      inviteUrl, status: "sent", reason,
      sentAt: new Date().toISOString(), expiresAt, usedAt: null,
    },
    mailRecord: {
      id: `mail_${randomUUID()}`, to: email,
      subject: reason === "magic-link-login" ? "[카니발 라이언 LMS] 로그인 링크" : "[카니발 라이언 LMS] 강의실 초대 링크",
      createdAt: new Date().toISOString(), deliveryStatus: "queued", preview: inviteUrl,
    },
  };
}

function hashPw(password, salt) {
  return pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}
function verifyPw(password, salt, hash) {
  return hashPw(password, salt) === hash;
}

function ensureUnlocked(enrollment) {
  if (!enrollment) throw httpError(403, "수강권이 없습니다.");
  if (!enrollment.emailVerified) throw httpError(403, "이메일 인증이 필요합니다.");
  if (!enrollment.contractSigned) throw httpError(403, "계약서 서명이 필요합니다.");
  if (enrollment.status !== "active") throw httpError(403, "활성 수강권이 필요합니다. (현재 상태: " + enrollment.status + ")");
  if (enrollment.accessExpiresAt && new Date(enrollment.accessExpiresAt).getTime() < Date.now()) {
    throw httpError(403, "강의 열람 기한(1년)이 만료되었습니다. 관리자에게 문의하세요.");
  }
}

function findCourse(db, courseId, enrollment) {
  const c = db.courses.find((c) => c.id === courseId);
  if (!c || !enrollment?.courseIds?.includes(c.id)) throw httpError(404, "수강 가능한 강의를 찾을 수 없습니다.");
  return c;
}

function findChapter(course, chapterId) {
  const ch = course.chapters.find((c) => c.id === chapterId);
  if (!ch) throw httpError(404, "챕터를 찾을 수 없습니다.");
  return ch;
}

function addLicenseLog(db, type, status, detail, userId = null) {
  const labels = {
    license_issued: "DRM 라이선스 발급", blocked_device_limit: "기기 제한 차단",
    session_completed: "시청 완료", session_replaced: "세션 교체",
    session_revoked: "세션 종료", session_expired: "세션 만료",
    license_checked: "라이선스 승인", device_registered: "기기 등록",
    devices_reset: "기기 초기화", imweb_order_paid: "아임웹 결제", imweb_refund: "아임웹 환불",
  };
  const statusLabels = { allowed: "허용", blocked: "차단", ended: "종료" };
  db.drm.licenseLog.unshift({
    id: `log_${randomUUID()}`, userId, type, title: labels[type] || type,
    status, statusLabel: statusLabels[status] || status, detail, createdAt: new Date().toISOString(),
  });
  db.drm.licenseLog = db.drm.licenseLog.slice(0, 100);
}

function formatNow() {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date());
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendOptions(req, res) {
  const origin = req.headers.origin || appUrl;
  res.writeHead(204, {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : appUrl,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  res.end();
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(__dirname, pathname));
  if (!target.startsWith(__dirname + path.sep) && target !== __dirname) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "no-cache" });
    res.end(data);
  });
}

// ── API handler ───────────────────────────────────────────────────────────────
async function handleApi(req, res, url) {
  const origin = req.headers.origin || appUrl;
  const allowOrigin = allowedOrigins.has(origin) ? origin : appUrl;

  function ok(payload, setCookie = null) {
    const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" };
    if (setCookie) h["Set-Cookie"] = setCookie;
    res.writeHead(200, h);
    res.end(JSON.stringify(payload, null, 2));
  }

  function fail(status, message, extra = {}) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" });
    res.end(JSON.stringify({ error: message, ...extra }, null, 2));
  }

  // ── Health ──
  if (req.method === "GET" && url.pathname === "/api/health") {
    ok({ ok: true, mode: supabase ? "supabase" : "local-file", supabaseConnected: !!supabase,
         r2Connected: !!r2, mailerConnected: mailReady, appUrl, apiUrl });
    return;
  }

  // ── Auth: whoami ──
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const db = await readDb();
    const adminSess = getAdminSession(req, db);
    if (adminSess) { ok({ role: "admin" }); return; }
    const studentSess = getStudentSession(req, db);
    if (studentSess) {
      const user = db.users.find((u) => u.id === studentSess.userId);
      ok({ role: "student", user: user || null });
      return;
    }
    fail(401, "로그인이 필요합니다.");
    return;
  }

  // ── Auth: student magic-link login request ──
  // ── Auth: invite-check (validate token without consuming) ──
  if (req.method === "GET" && url.pathname === "/api/auth/invite-check") {
    const token = url.searchParams.get("token") || "";
    if (!token) { fail(400, "토큰이 없습니다."); return; }
    const db = await readDb();
    const hash = sha256hex(token);
    const invite = db.invitations.find((i) => i.tokenHash === hash && i.status === "sent");
    if (!invite) { fail(404, "유효하지 않은 초대 링크입니다."); return; }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) { fail(410, "만료된 초대 링크입니다. 관리자에게 새 링크를 요청하세요."); return; }
    const user = db.users.find((u) => u.id === invite.userId || u.email === invite.email);
    if (user?.passwordHash) { fail(409, "이미 가입된 계정입니다. 로그인 페이지에서 로그인하세요."); return; }
    ok({ valid: true, email: invite.email, name: user?.name || "" });
    return;
  }

  // ── Auth: register (invite-only) ──
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const privacyConsent = !!body.privacyConsent;
    if (!token) { fail(400, "유효하지 않은 초대 링크입니다."); return; }
    if (!password || password.length < 8) { fail(400, "비밀번호는 8자 이상이어야 합니다."); return; }
    if (!privacyConsent) { fail(400, "개인정보 수집 및 이용에 동의해야 합니다."); return; }
    let setCookie = null;
    try {
      await updateDb((current) => {
        const hash = sha256hex(token);
        const invite = current.invitations.find((i) => i.tokenHash === hash && i.status === "sent");
        if (!invite) throw httpError(404, "유효하지 않은 초대 링크입니다. 관리자에게 새 링크를 요청하세요.");
        if (new Date(invite.expiresAt).getTime() <= Date.now()) throw httpError(410, "초대 링크가 만료되었습니다. 관리자에게 새 링크를 요청하세요.");
        const user = current.users.find((u) => u.id === invite.userId || u.email === invite.email);
        if (!user) throw httpError(404, "사용자를 찾을 수 없습니다.");
        if (user.passwordHash) throw httpError(409, "이미 가입된 계정입니다. 로그인 페이지에서 로그인하세요.");
        const salt = randomBytes(32).toString("hex");
        user.passwordHash = hashPw(password, salt);
        user.passwordSalt = salt;
        if (name) user.name = name;
        if (phone) user.phone = phone;
        user.privacyConsent = true;
        user.privacyConsentAt = new Date().toISOString();
        invite.usedAt = new Date().toISOString();
        invite.status = "used";
        const enrollment = current.enrollments.find((e) => e.userId === user.id);
        if (enrollment) {
          enrollment.emailVerified = true;
          // contractSigned는 강의실 첫 진입 시 학생이 직접 서명 — 여기서 자동 설정 금지
          enrollment.status = "pending_contract";
          enrollment.activatedAt = new Date().toISOString();
          enrollment.accessExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        }
        const sessionToken = `clms_${randomBytes(24).toString("hex")}`;
        current.sessions[tokenHash(sessionToken)] = {
          userId: user.id, issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(),
        };
        setCookie = makeSessionCookie("clms_session", sessionToken, Math.floor(SESSION_TTL / 1000));
        addLicenseLog(current, "register", "allowed", `${user.email} 회원가입 완료`, user.id);
      });
      ok({ ok: true, redirect: `${appUrl}/student.html` }, setCookie);
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Auth: login (email + password + device) ──
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const deviceId = String(body.deviceId || "").trim().slice(0, 64);
    if (!email || !password) { fail(400, "이메일과 비밀번호를 입력해 주세요."); return; }
    let setCookie = null;
    try {
      await updateDb((current) => {
        const user = current.users.find((u) => u.email === email);
        if (!user) throw httpError(404, "등록되지 않은 이메일입니다.");
        if (!user.passwordHash) throw httpError(401, "초대 링크를 통해 먼저 회원가입을 완료해 주세요.");
        if (!verifyPw(password, user.passwordSalt, user.passwordHash)) {
          throw httpError(401, "비밀번호가 올바르지 않습니다.");
        }
        const enrollment = current.enrollments.find((e) => e.userId === user.id);
        if (enrollment?.accessExpiresAt && new Date(enrollment.accessExpiresAt).getTime() < Date.now()) {
          throw httpError(403, "강의 열람 기한(1년)이 만료되었습니다. 관리자에게 문의하세요.");
        }
        // Device check
        const maxDevices = current.drm.policy.maxDevices || 2;
        if (!current.drm.devices) current.drm.devices = {};
        const userDevices = current.drm.devices[user.id] || [];
        const existingDevice = deviceId ? userDevices.find((d) => d.id === deviceId) : null;
        if (!existingDevice && deviceId) {
          if (userDevices.length >= maxDevices) {
            throw httpError(403, `등록 가능한 기기 한도(${maxDevices}대)를 초과했습니다. 기기를 변경하려면 관리자에게 문의하세요.`);
          }
          userDevices.push({ id: deviceId, label: `기기 ${userDevices.length + 1}`, registeredAt: formatNow() });
          current.drm.devices[user.id] = userDevices;
        }
        const sessionToken = `clms_${randomBytes(24).toString("hex")}`;
        current.sessions[tokenHash(sessionToken)] = {
          userId: user.id, issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(), deviceId,
        };
        setCookie = makeSessionCookie("clms_session", sessionToken, Math.floor(SESSION_TTL / 1000));
      });
      ok({ ok: true }, setCookie);
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Auth: student logout ──
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).clms_session;
    if (token) await updateDb((current) => { delete current.sessions[tokenHash(token)]; });
    ok({ ok: true }, clearCookie("clms_session"));
    return;
  }

  // ── Auth: admin login ──
  if (req.method === "POST" && url.pathname === "/api/auth/admin/login") {
    const body = await readJson(req);
    if (String(body.password || "") !== ADMIN_PASSWORD) {
      await new Promise((r) => setTimeout(r, 600));
      fail(401, "비밀번호가 올바르지 않습니다.");
      return;
    }
    const sessionToken = `clms_adm_${randomBytes(24).toString("hex")}`;
    const hash = tokenHash(sessionToken);
    const expiresAt = new Date(Date.now() + ADMIN_TTL).toISOString();
    await updateDb((current) => { current.adminSessions[hash] = { issuedAt: new Date().toISOString(), expiresAt }; });
    ok({ ok: true, redirect: `${appUrl}/admin.html` }, makeSessionCookie("clms_admin", sessionToken, Math.floor(ADMIN_TTL / 1000)));
    return;
  }

  // ── Auth: admin logout ──
  if (req.method === "POST" && url.pathname === "/api/auth/admin/logout") {
    const token = parseCookies(req.headers.cookie).clms_admin;
    if (token) await updateDb((current) => { delete current.adminSessions[tokenHash(token)]; });
    ok({ ok: true }, clearCookie("clms_admin"));
    return;
  }

  // ── Invite link: redirect to register page ──
  if (req.method === "GET" && url.pathname.startsWith("/invite/")) {
    const token = decodeURIComponent(url.pathname.replace("/invite/", ""));
    const db = await readDb();
    const hash = sha256hex(token);
    const invite = db.invitations.find((i) => i.tokenHash === hash);
    if (!invite || invite.status !== "sent") {
      res.writeHead(302, { Location: `${appUrl}/login.html?error=${encodeURIComponent("유효하지 않은 초대 링크입니다.")}` });
      res.end(); return;
    }
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      res.writeHead(302, { Location: `${appUrl}/login.html?error=${encodeURIComponent("초대 링크가 만료되었습니다. 관리자에게 새 링크를 요청하세요.")}` });
      res.end(); return;
    }
    const user = db.users.find((u) => u.id === invite.userId || u.email === invite.email);
    if (user?.passwordHash) {
      // Already registered — redirect to login
      res.writeHead(302, { Location: `${appUrl}/login.html?msg=already_registered&email=${encodeURIComponent(invite.email)}` });
      res.end(); return;
    }
    res.writeHead(302, { Location: `${appUrl}/register.html?token=${encodeURIComponent(token)}` });
    res.end();
    return;
  }

  // ── Student: state ──
  if (req.method === "GET" && url.pathname === "/api/state") {
    const db = await updateDb((current) => current);
    try {
      const { user, session } = requireStudent(req, db);
      ok(await toClientState(db, user.id, session.deviceId || null));
    } catch (e) { fail(e.status || 401, e.message); }
    return;
  }

  // ── Student: sign contract ──
  if (req.method === "POST" && url.pathname === "/api/contracts/sign") {
    const body = await readJson(req);
    let uid;
    const db = await updateDb((current) => {
      const { user, enrollment } = requireStudent(req, current);
      uid = user.id;
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!name || !email) throw httpError(400, "이름과 이메일이 필요합니다.");
      if (!body.confirmed) throw httpError(400, "계약 확인 동의가 필요합니다.");
      if (!enrollment) throw httpError(403, "수강권이 없습니다.");
      if (email !== enrollment.buyerEmail.toLowerCase()) throw httpError(409, "주문 이메일과 서명 이메일이 일치하지 않습니다.");
      user.name = name;
      enrollment.contractSigned = true;
      enrollment.status = "active";
      enrollment.emailVerified = true;
      current.contractSignatures.unshift({
        id: `contract_${randomUUID()}`, userId: user.id, enrollmentId: enrollment.id,
        version: "LMS-CONTRACT-2026.07-A",
        documentHash: sha256hex("LMS-CONTRACT-2026.07-A:content-protection:watermark:privacy"),
        name, email, signedAt: formatNow(), signatureMethod: "checkbox_agreement",
        ipAddress: (req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() || "unknown",
        userAgent: req.headers["user-agent"] || "",
      });
    });
    ok(await toClientState(db, uid));
    return;
  }

  // ── Student: playback session ──
  if (req.method === "POST" && url.pathname === "/api/playback/sessions") {
    const body = await readJson(req);
    let uid, playbackError = null;
    const r2Url = await generateR2PlaybackUrl(body.courseId, body.chapterId);
    const db = await updateDb((current) => {
      const { user, enrollment } = requireStudent(req, current);
      uid = user.id;
      ensureUnlocked(enrollment);
      const course = findCourse(current, body.courseId, enrollment);
      const chapter = findChapter(course, body.chapterId);
      const policy = current.drm.policy;
      const userDevices = current.drm.devices[user.id] || [];
      if (!current.drm.devices[user.id] && userDevices.length === 0) {
        const device = { id: `device-${randomBytes(4).toString("hex")}`, label: "기기 1", trusted: true, lastSeen: formatNow() };
        current.drm.devices[user.id] = [device];
        userDevices.push(device);
      }
      if (userDevices.length > policy.maxDevices) {
        addLicenseLog(current, "blocked_device_limit", "blocked", `기기 ${userDevices.length}대 제한 초과`, user.id);
        playbackError = "등록 기기 수가 초과되어 재생이 차단되었습니다.";
        return;
      }
      const token = `play_${randomBytes(16).toString("hex")}`;
      const expiresAt = new Date(Date.now() + policy.tokenTtlMinutes * 60 * 1000).toISOString();
      if (userDevices[0]) userDevices[0].lastSeen = formatNow();
      current.drm.activeSessions[user.id] = {
        id: `ps_${randomUUID()}`, userId: user.id, courseId: course.id,
        chapterId: chapter.id, chapterLabel: chapter.label, chapterTitle: chapter.title,
        assetId: course.videoAsset.assetId, manifestUrl: r2Url || course.videoAsset.manifestUrl,
        r2Connected: !!r2Url, licenseUrl: `${apiUrl}/api/drm/license`,
        tokenHash: sha256hex(token), tokenPreview: `${token.slice(0, 12)}...${token.slice(-6)}`,
        issuedAt: formatNow(), expiresAt, deviceId: userDevices[0]?.id, deviceLabel: userDevices[0]?.label,
        keySystems: course.videoAsset.keySystems,
        watermarkSubject: `${user.name} · ${user.email} · ${user.memberId}`,
      };
      const key = `${user.id}:${course.id}:${chapter.id}`;
      current.progress[key] = Math.max(current.progress[key] || 0, 45);
      addLicenseLog(current, "license_issued", "allowed", `${chapter.label} DRM 라이선스 발급`, user.id);
    });
    if (playbackError) { fail(409, playbackError, { state: uid ? await toClientState(db, uid) : {} }); return; }
    ok(await toClientState(db, uid));
    return;
  }

  // ── Student: complete chapter ──
  if (req.method === "POST" && url.pathname === "/api/progress/complete") {
    const body = await readJson(req);
    let uid;
    const db = await updateDb((current) => {
      const { user, enrollment } = requireStudent(req, current);
      uid = user.id;
      ensureUnlocked(enrollment);
      const course = findCourse(current, body.courseId, enrollment);
      const chapter = findChapter(course, body.chapterId);
      current.progress[`${user.id}:${course.id}:${chapter.id}`] = 100;
      if (current.drm.activeSessions?.[user.id]?.chapterId === chapter.id) delete current.drm.activeSessions[user.id];
      addLicenseLog(current, "session_completed", "ended", `${chapter.label} 시청 완료`, user.id);
    });
    ok(await toClientState(db, uid));
    return;
  }

  // ── Student: submit assignment ──
  if (req.method === "POST" && url.pathname === "/api/submissions") {
    const body = await readJson(req);
    let uid;
    const db = await updateDb((current) => {
      const { user, enrollment } = requireStudent(req, current);
      uid = user.id;
      ensureUnlocked(enrollment);
      const course = findCourse(current, body.courseId, enrollment);
      const chapter = findChapter(course, body.chapterId);
      const text = String(body.text || "").trim();
      if (!text) throw httpError(400, "과제 내용이 필요합니다.");
      current.submissions.unshift({
        id: `sub_${randomUUID()}`, userId: user.id, courseId: course.id, chapterId: chapter.id,
        chapterLabel: chapter.label, chapterTitle: chapter.title,
        studentName: user.name, studentEmail: user.email,
        text, fileName: String(body.fileName || "").trim(),
        status: "feedback_requested", createdAt: formatNow(), feedback: "", feedbackAt: "",
      });
    });
    ok(await toClientState(db, uid));
    return;
  }

  // ── Student: DRM license check ──
  if (req.method === "POST" && url.pathname === "/api/drm/license") {
    let uid;
    const db = await updateDb((current) => {
      const { user } = requireStudent(req, current);
      uid = user.id;
      const session = current.drm.activeSessions?.[user.id];
      if (!session) throw httpError(403, "활성 재생 세션이 없습니다.");
      addLicenseLog(current, "license_checked", "allowed", `${session.chapterLabel} 라이선스 요청 승인`, user.id);
    });
    ok({ ok: true, mode: "placeholder", activeSession: db.drm.activeSessions?.[uid] });
    return;
  }

  // ── Student: revoke own session ──
  if (req.method === "POST" && url.pathname === "/api/drm/sessions/revoke") {
    let uid, devId;
    const db = await updateDb((current) => {
      const { user, session } = requireStudent(req, current);
      uid = user.id; devId = session.deviceId;
      if (current.drm.activeSessions?.[user.id]) {
        addLicenseLog(current, "session_revoked", "ended", "학생이 재생 세션을 종료했습니다.", user.id);
        delete current.drm.activeSessions[user.id];
      }
    });
    ok(await toClientState(db, uid, devId));
    return;
  }

  // ── Student: change password ──
  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!currentPassword || !newPassword) { fail(400, "현재 비밀번호와 새 비밀번호를 입력해 주세요."); return; }
    if (newPassword.length < 8) { fail(400, "새 비밀번호는 8자 이상이어야 합니다."); return; }
    let uid, devId;
    try {
      const db = await updateDb((current) => {
        const { user, session } = requireStudent(req, current);
        uid = user.id; devId = session.deviceId;
        if (!verifyPw(currentPassword, user.passwordSalt, user.passwordHash)) throw httpError(401, "현재 비밀번호가 올바르지 않습니다.");
        const salt = randomBytes(32).toString("hex");
        user.passwordHash = hashPw(newPassword, salt);
        user.passwordSalt = salt;
      });
      ok(await toClientState(db, uid, devId));
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Student: remove own device ──
  if (req.method === "DELETE" && url.pathname === "/api/drm/devices") {
    const body = await readJson(req);
    const targetDeviceId = String(body.deviceId || "").trim();
    if (!targetDeviceId) { fail(400, "deviceId가 필요합니다."); return; }
    let uid, currentDevId, loggedOut = false;
    const db = await updateDb((current) => {
      const { user, session } = requireStudent(req, current);
      uid = user.id; currentDevId = session.deviceId;
      const thisMonth = new Date().toISOString().slice(0, 7);
      if (!current.drm.deviceRemovalLog) current.drm.deviceRemovalLog = {};
      const removalLog = current.drm.deviceRemovalLog[user.id] || [];
      const removalsThisMonth = removalLog.filter((r) => r.removedAt.startsWith(thisMonth)).length;
      if (removalsThisMonth >= 2) throw httpError(429, "이번 달 기기 삭제 가능 횟수(2회)를 초과했습니다.");
      const userDevices = current.drm.devices[user.id] || [];
      const idx = userDevices.findIndex((d) => d.id === targetDeviceId);
      if (idx === -1) throw httpError(404, "등록되지 않은 기기입니다.");
      const removed = userDevices.splice(idx, 1)[0];
      current.drm.devices[user.id] = userDevices;
      current.drm.deviceRemovalLog[user.id] = [...removalLog, { deviceId: targetDeviceId, label: removed.label, removedAt: new Date().toISOString() }];
      if (session.deviceId === targetDeviceId) {
        const token = parseCookies(req.headers.cookie).clms_session;
        delete current.sessions[tokenHash(token)];
        if (current.drm.activeSessions?.[user.id]) delete current.drm.activeSessions[user.id];
        loggedOut = true;
      }
    });
    ok({ ok: true, loggedOut, state: loggedOut ? null : await toClientState(db, uid, currentDevId) });
    return;
  }

  // ── Admin: state ──
  if (req.method === "GET" && url.pathname === "/api/admin/state") {
    const db = await updateDb((current) => current);
    try { requireAdmin(req, db); ok(toAdminState(db)); } catch (e) { fail(e.status || 401, e.message); }
    return;
  }

  // ── Admin: invite student ──
  if (req.method === "POST" && url.pathname === "/api/admin/students/invite") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim() || email.split("@")[0];
      const courseIds = Array.isArray(body.courseIds) && body.courseIds.length
        ? body.courseIds
        : current.courses.map((c) => c.id);
      if (!email) throw httpError(400, "이메일이 필요합니다.");
      let user = current.users.find((u) => u.email === email);
      if (!user) {
        user = { id: `user_${randomBytes(6).toString("hex")}`, name, email,
          memberId: `LMS-${randomBytes(3).toString("hex").toUpperCase()}`, role: "student", createdAt: new Date().toISOString() };
        current.users.push(user);
      }
      let enrollment = current.enrollments.find((e) => e.userId === user.id);
      if (!enrollment) {
        enrollment = { id: `enr_${randomUUID()}`, userId: user.id, orderNo: body.orderNo || `MANUAL-${Date.now()}`,
          buyerName: name, buyerEmail: email, paidAt: formatNow(),
          courseIds: courseIds.filter((id) => current.courses.some((c) => c.id === id)),
          emailVerified: false, contractSigned: false, status: "pending_invite" };
        current.enrollments.push(enrollment);
      } else {
        enrollment.courseIds = [...new Set([...enrollment.courseIds, ...courseIds])];
        if (enrollment.status === "refunded") { enrollment.status = "pending_invite"; enrollment.contractSigned = false; }
      }
      for (const inv of current.invitations) {
        if (inv.userId === user.id && inv.status === "sent") { inv.status = "revoked"; inv.revokedAt = new Date().toISOString(); }
      }
      const invite = createInviteRecord(email, user.id, "운영자 수동 초대");
      current.invitations.unshift(invite.publicRecord);
      current.mailOutbox.unshift(invite.mailRecord);
    });
    const user = db.users.find((u) => u.email === String(body.email || "").trim().toLowerCase());
    const invite = user && db.invitations.find((i) => i.userId === user.id && i.status === "sent" && !i.usedAt);
    if (invite) sendInviteMail(invite.email, invite.inviteUrl).catch((e) => console.error("초대 메일 발송 실패:", e.message));
    ok(toAdminState(db));
    return;
  }

  // ── Admin: resend invite ──
  if (req.method === "POST" && url.pathname === "/api/admin/invitations/resend") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const userId = body.userId;
      const user = current.users.find((u) => u.id === userId);
      if (!user) throw httpError(404, "사용자를 찾을 수 없습니다.");
      for (const inv of current.invitations) {
        if (inv.userId === userId && inv.status === "sent") { inv.status = "revoked"; inv.revokedAt = new Date().toISOString(); }
      }
      const invite = createInviteRecord(user.email, userId, "운영자 재발송");
      current.invitations.unshift(invite.publicRecord);
      current.mailOutbox.unshift(invite.mailRecord);
    });
    const user = db.users.find((u) => u.id === body.userId);
    const invite = user && db.invitations.find((i) => i.userId === user.id && i.status === "sent" && !i.usedAt);
    if (invite) sendInviteMail(invite.email, invite.inviteUrl).catch((e) => console.error("초대 재발송 실패:", e.message));
    ok(toAdminState(db));
    return;
  }

  // ── Admin: submission feedback ──
  if (req.method === "POST" && url.pathname === "/api/admin/submissions/feedback") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const sub = current.submissions.find((s) => s.id === body.submissionId);
      if (!sub) throw httpError(404, "제출 과제를 찾을 수 없습니다.");
      sub.feedback = String(body.feedback || "검토 완료했습니다. 다음 챕터에서 반영 내용을 확인해 주세요.").trim();
      sub.status = "feedback_sent";
      sub.feedbackAt = formatNow();
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: revoke student session ──
  if (req.method === "POST" && url.pathname === "/api/admin/drm/sessions/revoke") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const userId = body.userId;
      if (!userId) throw httpError(400, "userId가 필요합니다.");
      if (current.drm.activeSessions?.[userId]) {
        addLicenseLog(current, "session_revoked", "ended", "관리자가 재생 세션을 종료했습니다.", userId);
        delete current.drm.activeSessions[userId];
      }
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: reset student devices ──
  if (req.method === "POST" && url.pathname === "/api/admin/drm/devices/reset") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const userId = body.userId;
      if (!userId) throw httpError(400, "userId가 필요합니다.");
      current.drm.devices[userId] = [];
      if (current.drm.activeSessions?.[userId]) {
        addLicenseLog(current, "devices_reset", "ended", "기기 초기화로 세션 종료", userId);
        delete current.drm.activeSessions[userId];
      }
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: contract reset ──
  if (req.method === "POST" && url.pathname === "/api/admin/contracts/reset") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const userId = body.userId;
      const enrollment = current.enrollments.find((e) => e.userId === userId);
      if (!enrollment) throw httpError(404, "수강 정보를 찾을 수 없습니다.");
      enrollment.contractSigned = false;
      enrollment.status = enrollment.emailVerified ? "pending_contract" : "pending_invite";
      if (current.drm.activeSessions?.[userId]) {
        addLicenseLog(current, "session_revoked", "ended", "계약서 초기화로 세션 종료", userId);
        delete current.drm.activeSessions[userId];
      }
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: issue student session without device slot (for testing) ──
  if (req.method === "POST" && url.pathname === "/api/admin/students/impersonate") {
    const body = await readJson(req);
    let setCookie = null;
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const userId = String(body.userId || "").trim();
      const user = current.users.find((u) => u.id === userId);
      if (!user) throw httpError(404, "사용자를 찾을 수 없습니다.");
      const sessionToken = `clms_${randomBytes(24).toString("hex")}`;
      current.sessions[tokenHash(sessionToken)] = {
        userId: user.id, issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        deviceId: null, adminIssued: true,
      };
      setCookie = makeSessionCookie("clms_session", sessionToken, 2 * 60 * 60);
    });
    ok({ ok: true }, setCookie);
    return;
  }

  // ── Admin: reset student password ──
  if (req.method === "POST" && url.pathname === "/api/admin/users/reset-password") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const userId = String(body.userId || "").trim();
      const newPassword = String(body.newPassword || "").trim();
      if (!userId) throw httpError(400, "userId가 필요합니다.");
      if (!newPassword || newPassword.length < 8) throw httpError(400, "새 비밀번호는 8자 이상이어야 합니다.");
      const user = current.users.find((u) => u.id === userId);
      if (!user) throw httpError(404, "사용자를 찾을 수 없습니다.");
      const salt = randomBytes(32).toString("hex");
      user.passwordHash = hashPw(newPassword, salt);
      user.passwordSalt = salt;
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: test email ──
  if (req.method === "POST" && url.pathname === "/api/admin/test-email") {
    const body = await readJson(req);
    const db = await readDb();
    try { requireAdmin(req, db); } catch (e) { fail(e.status, e.message); return; }
    const to = String(body.to || GMAIL_FROM || "");
    if (!to) { fail(400, "수신 이메일 필요"); return; }
    if (!mailReady) { fail(503, "메일러 미설정 (GMAIL_CLIENT_ID, GMAIL_REFRESH_TOKEN 확인)"); return; }
    try {
      const info = await sendMail(to, "[카니발 라이언 LMS] 이메일 테스트", "<p>이메일 발송 테스트 메시지입니다.</p>");
      ok({ ok: true, messageId: info.messageId, to });
    } catch (e) {
      fail(500, `메일 발송 실패: ${e.message}`);
    }
    return;
  }

  // ── Admin: R2 status ──
  if (req.method === "GET" && url.pathname === "/api/admin/r2/status") {
    const db = await readDb();
    try { requireAdmin(req, db); } catch (e) { fail(e.status, e.message); return; }
    let bucketOk = false, videoCount = 0;
    if (r2) {
      try {
        const list = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "videos/", MaxKeys: 100 }));
        bucketOk = true; videoCount = (list.Contents || []).length;
      } catch {}
    }
    ok({ r2Connected: !!r2, bucketOk, bucket: R2_BUCKET, endpoint: R2_ENDPOINT || null, videoCount });
    return;
  }

  // ── Admin: R2 videos list ──
  if (req.method === "GET" && url.pathname === "/api/admin/r2/videos") {
    const db = await readDb();
    try { requireAdmin(req, db); } catch (e) { fail(e.status, e.message); return; }
    if (!r2) { fail(503, "R2 미연결"); return; }
    const list = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "videos/", MaxKeys: 200 }));
    const files = (list.Contents || []).map((obj) => ({
      key: obj.Key, size: obj.Size, lastModified: obj.LastModified,
      courseId: obj.Key.split("/")[1] || "", chapterId: obj.Key.split("/")[2] || "",
    }));
    ok({ bucket: R2_BUCKET, files });
    return;
  }

  // ── Admin: R2 upload URL ──
  if (req.method === "POST" && url.pathname === "/api/admin/r2/upload-url") {
    const db = await readDb();
    try { requireAdmin(req, db); } catch (e) { fail(e.status, e.message); return; }
    if (!r2) { fail(503, "R2 미연결"); return; }
    const body = await readJson(req);
    if (!body.courseId || !body.chapterId) { fail(400, "courseId와 chapterId가 필요합니다."); return; }
    const result = await generateR2UploadUrl(body.courseId, body.chapterId, body.contentType);
    ok(result);
    return;
  }

  // ── Admin: R2 delete video ──
  if (req.method === "DELETE" && url.pathname === "/api/admin/r2/videos") {
    const db = await readDb();
    try { requireAdmin(req, db); } catch (e) { fail(e.status, e.message); return; }
    if (!r2) { fail(503, "R2 미연결"); return; }
    const body = await readJson(req);
    const key = String(body.key || "").trim();
    if (!key || !key.startsWith("videos/")) { fail(400, "유효하지 않은 키입니다."); return; }
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      ok({ ok: true, deleted: key });
    } catch (e) { fail(500, e.message); }
    return;
  }

  // ── Admin: R2 preview URL ──
  if (req.method === "POST" && url.pathname === "/api/admin/r2/preview-url") {
    const db = await readDb();
    try { requireAdmin(req, db); } catch (e) { fail(e.status, e.message); return; }
    if (!r2) { fail(503, "R2 미연결"); return; }
    const body = await readJson(req);
    const key = String(body.key || "").trim();
    if (!key || !key.startsWith("videos/")) { fail(400, "유효하지 않은 키입니다."); return; }
    try {
      const previewUrl = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 300 });
      ok({ previewUrl });
    } catch (e) { fail(500, e.message); }
    return;
  }

  // ── Imweb: order paid ──
  if (req.method === "POST" && url.pathname === "/api/imweb/webhooks/order-paid") {
    if (IMWEB_WEBHOOK_SECRET && url.searchParams.get("secret") !== IMWEB_WEBHOOK_SECRET) {
      fail(401, "웹훅 시크릿이 올바르지 않습니다."); return;
    }
    const body = await readJson(req);
    const buyerEmail = String(body.email || body.buyer_email || body.buyerEmail || "").trim().toLowerCase();
    const buyerName = String(body.name || body.buyer_name || body.buyerName || "").trim();
    const orderNo = String(body.order_no || body.orderNo || "").trim();
    const productCodes = (body.products || body.items || []).map((p) => String(p.code || p.prod_code || p.product_code || "").trim()).filter(Boolean);
    const mappedCourseIds = productCodes.length
      ? current.courses.filter((c) => productCodes.includes(c.productId)).map((c) => c.id)
      : current.courses.map((c) => c.id);
    const db = await updateDb((current) => {
      if (!buyerEmail) throw httpError(400, "구매자 이메일이 없습니다.");
      let user = current.users.find((u) => u.email === buyerEmail);
      if (!user) {
        user = { id: `user_${randomBytes(6).toString("hex")}`, name: buyerName || buyerEmail.split("@")[0],
          email: buyerEmail, memberId: `LMS-${randomBytes(3).toString("hex").toUpperCase()}`,
          role: "student", createdAt: new Date().toISOString() };
        current.users.push(user);
      } else if (buyerName) { user.name = buyerName; }
      let enrollment = current.enrollments.find((e) => e.userId === user.id);
      if (!enrollment) {
        enrollment = { id: `enr_${randomUUID()}`, userId: user.id, orderNo, buyerName: buyerName || user.name,
          buyerEmail, paidAt: formatNow(), courseIds: mappedCourseIds,
          emailVerified: false, contractSigned: false, status: "pending_invite" };
        current.enrollments.push(enrollment);
      } else {
        enrollment.orderNo = orderNo || enrollment.orderNo;
        enrollment.courseIds = mappedCourseIds;
        enrollment.contractSigned = false;
        enrollment.status = "pending_invite";
        if (current.drm.activeSessions?.[user.id]) delete current.drm.activeSessions[user.id];
      }
      const invite = createInviteRecord(buyerEmail, user.id, "아임웹 결제 완료 웹훅");
      current.invitations.unshift(invite.publicRecord);
      current.mailOutbox.unshift(invite.mailRecord);
      addLicenseLog(current, "imweb_order_paid", "allowed", `${orderNo} 주문 수강권 생성`, user.id);
    });
    const invite = db.invitations[0];
    if (invite) sendInviteMail(invite.email, invite.inviteUrl).catch((e) => console.error("초대 메일 발송 실패:", e.message));
    ok({ ok: true });
    return;
  }

  // ── Imweb: refund ──
  if (req.method === "POST" && url.pathname === "/api/imweb/webhooks/refund") {
    if (IMWEB_WEBHOOK_SECRET && url.searchParams.get("secret") !== IMWEB_WEBHOOK_SECRET) {
      fail(401, "웹훅 시크릿이 올바르지 않습니다."); return;
    }
    const body = await readJson(req);
    const orderNo = String(body.order_no || body.orderNo || "").trim();
    await updateDb((current) => {
      const enrollment = current.enrollments.find((e) => e.orderNo === orderNo);
      if (!enrollment) throw httpError(404, "해당 주문번호를 찾을 수 없습니다.");
      enrollment.status = "refunded";
      enrollment.contractSigned = false;
      if (current.drm.activeSessions?.[enrollment.userId]) {
        addLicenseLog(current, "imweb_refund", "ended", `${orderNo} 환불로 세션 종료`, enrollment.userId);
        delete current.drm.activeSessions[enrollment.userId];
      }
    });
    ok({ ok: true });
    return;
  }

  // ── Admin: imweb orders ──
  if (req.method === "GET" && url.pathname === "/api/admin/imweb/orders") {
    const db = await updateDb((current) => current);
    try {
      requireAdmin(req, db);
      const page = url.searchParams.get("page") || "1";
      const limit = url.searchParams.get("limit") || "20";
      const data = await imwebGet("/v2/shop/orders", { offset: page, limit });
      ok(data);
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: imweb members ──
  if (req.method === "GET" && url.pathname === "/api/admin/imweb/members") {
    const db = await updateDb((current) => current);
    try {
      requireAdmin(req, db);
      const page = url.searchParams.get("page") || "1";
      const limit = url.searchParams.get("limit") || "20";
      const data = await imwebGet("/v2/member/members", { offset: page, limit });
      ok(data);
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: imweb products ──
  if (req.method === "GET" && url.pathname === "/api/admin/imweb/products") {
    const db = await updateDb((current) => current);
    try {
      requireAdmin(req, db);
      const data = await imwebGet("/v2/shop/products", { offset: "1", limit: "50" });
      ok(data);
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: regenerate invite link for existing student ──
  if (req.method === "POST" && /^\/api\/admin\/students\/[^/]+\/invite-link$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    try {
      const db = await updateDb((current) => {
        requireAdmin(req, current);
        const user = current.users.find((u) => u.id === userId);
        if (!user) throw httpError(404, "학생을 찾을 수 없습니다.");
        const invite = createInviteRecord(user.email, userId, "관리자 초대 링크 재발급");
        current.invitations.unshift(invite.publicRecord);
        current.mailOutbox.unshift(invite.mailRecord);
      });
      const invite = db.invitations.find((i) => i.userId === userId && !i.usedAt);
      ok({ ok: true, inviteUrl: invite?.inviteUrl });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: create invite from order (manual trigger) ──
  if (req.method === "POST" && url.pathname === "/api/admin/orders/invite") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const orderNo = String(body.orderNo || "").trim();
    const courseIds = Array.isArray(body.courseIds) ? body.courseIds : [];
    try {
      const db = await updateDb((current) => {
        requireAdmin(req, current);
        if (!email) throw httpError(400, "이메일이 없습니다.");
        let user = current.users.find((u) => u.email === email);
        if (!user) {
          user = { id: `user_${randomBytes(6).toString("hex")}`, name: name || email.split("@")[0],
            email, memberId: `LMS-${randomBytes(3).toString("hex").toUpperCase()}`,
            role: "student", createdAt: new Date().toISOString() };
          current.users.push(user);
        } else if (name) { user.name = name; }
        let enrollment = current.enrollments.find((e) => e.userId === user.id);
        const finalCourseIds = courseIds.length ? courseIds : (enrollment?.courseIds || []);
        if (!enrollment) {
          enrollment = { id: `enr_${randomUUID()}`, userId: user.id, orderNo,
            buyerName: name || user.name, buyerEmail: email,
            paidAt: formatNow(), courseIds: finalCourseIds,
            emailVerified: false, contractSigned: false, status: "pending_invite" };
          current.enrollments.push(enrollment);
        } else {
          if (orderNo) enrollment.orderNo = orderNo;
          if (courseIds.length) enrollment.courseIds = finalCourseIds;
          enrollment.status = "pending_invite";
        }
        const invite = createInviteRecord(email, user.id, "관리자 직접 초대");
        current.invitations.unshift(invite.publicRecord);
        current.mailOutbox.unshift(invite.mailRecord);
        addLicenseLog(current, "admin_manual_invite", "allowed", `관리자가 ${email} 초대 링크 생성`, user.id);
      });
      const invite = db.invitations[0];
      const userId2 = db.users.find((u) => u.email === email)?.id;
      ok({ ok: true, inviteUrl: invite?.inviteUrl, userId: userId2 });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: preview student state ──
  if (req.method === "GET" && /^\/api\/admin\/students\/[^/]+\/preview$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    const db = await updateDb((current) => current);
    try {
      requireAdmin(req, db);
      const clientState = await toClientState(db, userId);
      if (clientState.error) { fail(404, "학생을 찾을 수 없습니다."); return; }
      ok({ ...clientState, _previewMode: true });
    } catch (e) { fail(e.status || 401, e.message); }
    return;
  }

  // ── Admin: add course ──
  if (req.method === "POST" && url.pathname === "/api/admin/courses") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const title = String(body.title || "").trim();
      if (!title) throw httpError(400, "강의 제목이 필요합니다.");
      const id = `course_${randomBytes(6).toString("hex")}`;
      const roomNum = current.courses.length + 1;
      current.courses.push({
        id,
        productId: body.productId || `COURSE-${id.toUpperCase()}`,
        videoAsset: { assetId: `vod-${id}`, manifestUrl: "", packaging: "", keySystems: [] },
        title,
        room: body.room || `${roomNum}강의실`,
        subtitle: body.subtitle || "",
        artClass: "",
        chapters: [],
      });
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: update course mapping (productId / imwebProductLabel) ──
  if (req.method === "PATCH" && /^\/api\/admin\/courses\/[^/]+$/.test(url.pathname)) {
    const courseId = url.pathname.split("/").pop();
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const course = current.courses.find((c) => c.id === courseId);
      if (!course) throw httpError(404, "강의를 찾을 수 없습니다.");
      if (body.productId !== undefined) course.productId = String(body.productId || "").trim();
      if (body.imwebProductLabel !== undefined) course.imwebProductLabel = String(body.imwebProductLabel || "").trim();
      if (body.title !== undefined && String(body.title).trim()) course.title = String(body.title).trim();
      if (body.room !== undefined && String(body.room).trim()) course.room = String(body.room).trim();
      if (body.subtitle !== undefined) course.subtitle = String(body.subtitle || "").trim();
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: delete course ──
  if (req.method === "DELETE" && /^\/api\/admin\/courses\/[^/]+$/.test(url.pathname)) {
    const courseId = url.pathname.split("/").pop();
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const idx = current.courses.findIndex((c) => c.id === courseId);
      if (idx === -1) throw httpError(404, "강의를 찾을 수 없습니다.");
      current.courses.splice(idx, 1);
      for (const enr of current.enrollments) {
        enr.courseIds = (enr.courseIds || []).filter((id) => id !== courseId);
      }
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: add chapter ──
  if (req.method === "POST" && /^\/api\/admin\/courses\/[^/]+\/chapters$/.test(url.pathname)) {
    const courseId = url.pathname.split("/")[4];
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const course = current.courses.find((c) => c.id === courseId);
      if (!course) throw httpError(404, "강의를 찾을 수 없습니다.");
      const title = String(body.title || "").trim();
      if (!title) throw httpError(400, "챕터 제목이 필요합니다.");
      const chNum = course.chapters.length + 1;
      course.chapters.push({
        id: `ch_${randomBytes(5).toString("hex")}`,
        label: `Chapter ${chNum}`,
        title,
        duration: body.duration || "",
        material: body.material || "",
      });
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: delete chapter ──
  if (req.method === "DELETE" && /^\/api\/admin\/courses\/[^/]+\/chapters\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    const courseId = parts[4];
    const chapterId = parts[6];
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const course = current.courses.find((c) => c.id === courseId);
      if (!course) throw httpError(404, "강의를 찾을 수 없습니다.");
      const idx = course.chapters.findIndex((ch) => ch.id === chapterId);
      if (idx === -1) throw httpError(404, "챕터를 찾을 수 없습니다.");
      course.chapters.splice(idx, 1);
      course.chapters.forEach((ch, i) => { ch.label = `Chapter ${i + 1}`; });
    });
    ok(toAdminState(db));
    return;
  }

  // ── Admin: update student course enrollment ──
  if (req.method === "POST" && /^\/api\/admin\/students\/[^/]+\/courses$/.test(url.pathname)) {
    const userId = url.pathname.split("/")[4];
    const body = await readJson(req);
    const db = await updateDb((current) => {
      requireAdmin(req, current);
      const user = current.users.find((u) => u.id === userId);
      if (!user) throw httpError(404, "학생을 찾을 수 없습니다.");
      let enrollment = current.enrollments.find((e) => e.userId === userId);
      if (!enrollment) {
        enrollment = { id: `enr_${randomUUID()}`, userId, orderNo: `MANUAL-${Date.now()}`,
          buyerName: user.name, buyerEmail: user.email, paidAt: formatNow(),
          courseIds: [], emailVerified: false, contractSigned: false, status: "pending_invite" };
        current.enrollments.push(enrollment);
      }
      if (body.action === "add") {
        const courseId = body.courseId;
        if (!current.courses.find((c) => c.id === courseId)) throw httpError(404, "강의를 찾을 수 없습니다.");
        enrollment.courseIds = [...new Set([...(enrollment.courseIds || []), courseId])];
      } else if (body.action === "remove") {
        enrollment.courseIds = (enrollment.courseIds || []).filter((id) => id !== body.courseId);
      } else if (body.action === "set") {
        const validIds = (body.courseIds || []).filter((id) => current.courses.some((c) => c.id === id));
        enrollment.courseIds = validIds;
      }
    });
    ok(toAdminState(db));
    return;
  }

  // ── Dev reset ──
  if (req.method === "POST" && url.pathname === "/api/demo/reset") {
    await writeDb(defaultDb());
    ok({ ok: true, message: "DB 초기화 완료" });
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Board: get posts for a course ──
  if (req.method === "GET" && /^\/api\/courses\/[^/]+\/board$/.test(url.pathname)) {
    try {
      const { user } = await requireStudent(req, db);
      const courseId = url.pathname.split("/")[3];
      if (!(user.role === "admin" || db.enrollments.find((e) => e.userId === user.id && (e.courseIds || []).includes(courseId)))) {
        fail(403, "수강 중인 강의가 아닙니다."); return;
      }
      const posts = (db.board[courseId] || []).slice(0, 200);
      ok({ posts });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Board: create post ──
  if (req.method === "POST" && /^\/api\/courses\/[^/]+\/board\/posts$/.test(url.pathname)) {
    try {
      const { user, enrollment } = await requireStudent(req, db);
      const courseId = url.pathname.split("/")[3];
      if (!(enrollment?.courseIds || []).includes(courseId)) { fail(403, "수강 중인 강의가 아닙니다."); return; }
      const body = await readJson(req);
      const content = String(body.content || "").trim().slice(0, 2000);
      if (!content) { fail(400, "내용을 입력해 주세요."); return; }
      let newPost;
      await updateDb((current) => {
        if (!current.board[courseId]) current.board[courseId] = [];
        newPost = {
          id: `post_${randomUUID()}`,
          courseId, userId: user.id,
          nickname: user.name || user.email.split("@")[0],
          content, comments: [],
          createdAt: new Date().toISOString(),
        };
        current.board[courseId].unshift(newPost);
        if (current.board[courseId].length > 500) current.board[courseId].pop();
      });
      ok({ ok: true, post: newPost });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Board: delete post ──
  if (req.method === "DELETE" && /^\/api\/courses\/[^/]+\/board\/posts\/[^/]+$/.test(url.pathname)) {
    try {
      const { user } = await requireStudent(req, db);
      const parts = url.pathname.split("/");
      const courseId = parts[3]; const postId = parts[6];
      await updateDb((current) => {
        const posts = current.board[courseId] || [];
        const idx = posts.findIndex((p) => p.id === postId);
        if (idx < 0) throw httpError(404, "게시글을 찾을 수 없습니다.");
        if (posts[idx].userId !== user.id && user.role !== "admin") throw httpError(403, "본인 게시글만 삭제할 수 있습니다.");
        posts.splice(idx, 1);
      });
      ok({ ok: true });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Board: add comment ──
  if (req.method === "POST" && /^\/api\/courses\/[^/]+\/board\/posts\/[^/]+\/comments$/.test(url.pathname)) {
    try {
      const { user, enrollment } = await requireStudent(req, db);
      const parts = url.pathname.split("/");
      const courseId = parts[3]; const postId = parts[6];
      if (!(enrollment?.courseIds || []).includes(courseId)) { fail(403, "수강 중인 강의가 아닙니다."); return; }
      const body = await readJson(req);
      const content = String(body.content || "").trim().slice(0, 500);
      if (!content) { fail(400, "댓글 내용을 입력해 주세요."); return; }
      let newComment;
      await updateDb((current) => {
        const posts = current.board[courseId] || [];
        const post = posts.find((p) => p.id === postId);
        if (!post) throw httpError(404, "게시글을 찾을 수 없습니다.");
        if (!post.comments) post.comments = [];
        newComment = {
          id: `cmt_${randomUUID()}`,
          userId: user.id,
          nickname: user.name || user.email.split("@")[0],
          content,
          createdAt: new Date().toISOString(),
        };
        post.comments.push(newComment);
        if (post.comments.length > 100) post.comments.shift();
      });
      ok({ ok: true, comment: newComment });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Board: delete comment ──
  if (req.method === "DELETE" && /^\/api\/courses\/[^/]+\/board\/posts\/[^/]+\/comments\/[^/]+$/.test(url.pathname)) {
    try {
      const { user } = await requireStudent(req, db);
      const parts = url.pathname.split("/");
      const courseId = parts[3]; const postId = parts[6]; const commentId = parts[8];
      await updateDb((current) => {
        const posts = current.board[courseId] || [];
        const post = posts.find((p) => p.id === postId);
        if (!post) throw httpError(404, "게시글을 찾을 수 없습니다.");
        const idx = (post.comments || []).findIndex((c) => c.id === commentId);
        if (idx < 0) throw httpError(404, "댓글을 찾을 수 없습니다.");
        if (post.comments[idx].userId !== user.id && user.role !== "admin") throw httpError(403, "본인 댓글만 삭제할 수 있습니다.");
        post.comments.splice(idx, 1);
      });
      ok({ ok: true });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Student: submit question ──
  if (req.method === "POST" && url.pathname === "/api/questions") {
    try {
      const { user, enrollment } = await requireStudent(req, db);
      const body = await readJson(req);
      const courseId = String(body.courseId || "").trim();
      const content = String(body.content || "").trim().slice(0, 3000);
      if (!courseId || !content) { fail(400, "강의와 질문 내용을 입력해 주세요."); return; }
      if (!(enrollment?.courseIds || []).includes(courseId)) { fail(403, "수강 중인 강의가 아닙니다."); return; }
      let newQuestion;
      await updateDb((current) => {
        if (!current.questions) current.questions = [];
        newQuestion = {
          id: `q_${randomUUID()}`,
          courseId, userId: user.id,
          studentName: user.name || "학생",
          studentEmail: user.email,
          content,
          answer: null, answeredAt: null,
          createdAt: new Date().toISOString(),
        };
        current.questions.unshift(newQuestion);
        if (current.questions.length > 1000) current.questions.pop();
      });
      ok({ ok: true, question: newQuestion });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: answer question ──
  if (req.method === "POST" && /^\/api\/admin\/questions\/[^/]+\/answer$/.test(url.pathname)) {
    try {
      await requireAdmin(req, db);
      const questionId = url.pathname.split("/")[4];
      const body = await readJson(req);
      const answer = String(body.answer || "").trim().slice(0, 5000);
      if (!answer) { fail(400, "답변 내용을 입력해 주세요."); return; }
      await updateDb((current) => {
        const q = (current.questions || []).find((q) => q.id === questionId);
        if (!q) throw httpError(404, "질문을 찾을 수 없습니다.");
        q.answer = answer;
        q.answeredAt = new Date().toISOString();
      });
      db = await readDb();
      ok(toAdminState(db));
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  // ── Admin: delete board post ──
  if (req.method === "DELETE" && /^\/api\/admin\/board\/[^/]+\/posts\/[^/]+$/.test(url.pathname)) {
    try {
      await requireAdmin(req, db);
      const parts = url.pathname.split("/");
      const courseId = parts[4]; const postId = parts[6];
      await updateDb((current) => {
        if (!current.board[courseId]) return;
        const idx = current.board[courseId].findIndex((p) => p.id === postId);
        if (idx >= 0) current.board[courseId].splice(idx, 1);
      });
      ok({ ok: true });
    } catch (e) { fail(e.status || 500, e.message); }
    return;
  }

  fail(404, "API 경로를 찾을 수 없습니다.");
}

// ── Imweb API client ──────────────────────────────────────────────────────────
let _imwebToken = null;
let _imwebTokenExpiresAt = 0;

async function getImwebToken() {
  if (!IMWEB_API_KEY || !IMWEB_SECRET_KEY) throw httpError(503, "아임웹 API 키가 설정되지 않았습니다.");
  if (_imwebToken && Date.now() < _imwebTokenExpiresAt - 60000) return _imwebToken;
  const res = await fetch(
    `https://api.imweb.me/v2/auth?key=${encodeURIComponent(IMWEB_API_KEY)}&secret=${encodeURIComponent(IMWEB_SECRET_KEY)}`
  );
  const data = await res.json();
  if (!res.ok || data.code !== 200 || !data.access_token) throw httpError(502, `아임웹 인증 실패: ${data.msg || res.status}`);
  _imwebToken = data.access_token;
  _imwebTokenExpiresAt = Date.now() + 7200 * 1000;
  return _imwebToken;
}

async function imwebGet(path, params = {}) {
  const token = await getImwebToken();
  const qs = Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`https://api.imweb.me${path}${qs}`, {
    headers: { "access-token": token },
  });
  const data = await res.json();
  if (!res.ok || data.code !== 200) throw httpError(502, `아임웹 API 오류: ${data.msg || res.status}`);
  return data;
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (req.method === "OPTIONS") { sendOptions(req, res); return; }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/invite/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    const origin = req.headers.origin || appUrl;
    const allow = allowedOrigins.has(origin) ? origin : appUrl;
    if (!res.headersSent) {
      res.writeHead(error.status || 500, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Credentials": "true",
      });
      res.end(JSON.stringify({ error: error.message || "서버 오류" }));
    }
  }
});

server.listen(port, bindHost, () => {
  console.log(`카니발 라이언 LMS: ${apiUrl}/`);
  console.log(`DB: ${supabase ? "Supabase" : "로컬 파일"}`);
  console.log(`Admin PW: ${ADMIN_PASSWORD ? "(설정됨)" : "(미설정)"}`);
});
