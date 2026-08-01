const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { S3Client, ListObjectsV2Command, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "db.json");
const portArgIndex = process.argv.indexOf("--port");
const port = Number(process.env.PORT || (portArgIndex >= 0 ? process.argv[portArgIndex + 1] : 8941));
const bindHost = process.env.BIND_HOST || (process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1");
const appUrl = process.env.APP_URL || `http://127.0.0.1:${port}`;
const apiUrl = process.env.API_URL || `http://127.0.0.1:${port}`;
const allowedOrigins = new Set(
  [appUrl, apiUrl, `http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(process.env.CORS_ORIGINS || "").split(",")]
    .map((origin) => origin.trim())
    .filter(Boolean),
);

// Cloudflare R2 (S3-compatible)
const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "lms-videos";
const R2_PLAYBACK_TTL_SECONDS = Number(process.env.R2_PLAYBACK_TTL_SECONDS || 3600);

const r2 = R2_ENDPOINT && R2_ACCESS_KEY_ID
  ? new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

async function r2VideoKey(courseId, chapterId) {
  return `videos/${courseId}/${chapterId}/video.mp4`;
}

async function generateR2PlaybackUrl(courseId, chapterId) {
  if (!r2) return null;
  try {
    const key = await r2VideoKey(courseId, chapterId);
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), {
      expiresIn: R2_PLAYBACK_TTL_SECONDS,
    });
  } catch {
    return null;
  }
}

async function generateR2UploadUrl(courseId, chapterId, contentType) {
  if (!r2) throw new Error("R2 미연결");
  const key = await r2VideoKey(courseId, chapterId);
  const url = await getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType || "video/mp4" }),
    { expiresIn: 3600 },
  );
  return { uploadUrl: url, key, bucket: R2_BUCKET };
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const courses = [
  {
    id: "creator-ai",
    productId: "COURSE-AI-01",
    videoAsset: {
      assetId: "vod-ai-master-001",
      manifestUrl: "https://cdn.example.com/vod-ai-master/manifest.mpd",
      packaging: "CENC + HLS FairPlay",
      keySystems: ["Widevine", "FairPlay", "PlayReady"],
    },
    title: "AI 콘텐츠 제작 마스터",
    room: "1강의실",
    subtitle: "기획부터 자동화까지",
    artClass: "",
    chapters: [
      {
        id: "ai-01",
        label: "Chapter 1",
        title: "강의실 세팅과 학습 루틴",
        duration: "18분",
        material: "온보딩 체크리스트.pdf",
      },
      {
        id: "ai-02",
        label: "Chapter 2",
        title: "콘텐츠 기획 프레임 만들기",
        duration: "27분",
        material: "기획 템플릿.xlsx",
      },
      {
        id: "ai-03",
        label: "Chapter 3",
        title: "제작 자동화 워크플로우",
        duration: "34분",
        material: "자동화 플로우.pdf",
      },
    ],
  },
  {
    id: "design-system",
    productId: "COURSE-DS-02",
    videoAsset: {
      assetId: "vod-design-system-002",
      manifestUrl: "https://cdn.example.com/vod-design-system/manifest.mpd",
      packaging: "CENC + HLS FairPlay",
      keySystems: ["Widevine", "FairPlay", "PlayReady"],
    },
    title: "브랜드 디자인 시스템",
    room: "2강의실",
    subtitle: "반복 가능한 디자인 운영",
    artClass: "design",
    chapters: [
      {
        id: "ds-01",
        label: "Chapter 1",
        title: "브랜드 톤과 UI 원칙",
        duration: "22분",
        material: "브랜드 원칙.pdf",
      },
      {
        id: "ds-02",
        label: "Chapter 2",
        title: "컴포넌트와 템플릿 정리",
        duration: "31분",
        material: "컴포넌트 보드.fig",
      },
      {
        id: "ds-03",
        label: "Chapter 3",
        title: "검수 기준과 배포 루틴",
        duration: "25분",
        material: "검수 체크리스트.pdf",
      },
    ],
  },
  {
    id: "feedback-lab",
    productId: "COURSE-FB-03",
    videoAsset: {
      assetId: "vod-feedback-lab-003",
      manifestUrl: "https://cdn.example.com/vod-feedback-lab/manifest.mpd",
      packaging: "CENC + HLS FairPlay",
      keySystems: ["Widevine", "FairPlay", "PlayReady"],
    },
    title: "1:1 피드백 랩",
    room: "3강의실",
    subtitle: "과제 중심 실전 코칭",
    artClass: "feedback",
    chapters: [
      {
        id: "fb-01",
        label: "Chapter 1",
        title: "진단 과제 제출",
        duration: "14분",
        material: "진단 과제 안내.pdf",
      },
      {
        id: "fb-02",
        label: "Chapter 2",
        title: "피드백 반영과 재제출",
        duration: "20분",
        material: "피드백 반영표.docx",
      },
      {
        id: "fb-03",
        label: "Chapter 3",
        title: "최종 리뷰와 다음 액션",
        duration: "19분",
        material: "최종 리뷰 노트.pdf",
      },
    ],
  },
];

function defaultDb() {
  const invite = createInviteRecord("student@example.com", "초기 초대 발송");

  return {
    schemaVersion: 1,
    courses,
    user: {
      id: "user_001",
      name: "김수강",
      email: "student@example.com",
      memberId: "LMS-260731-001",
      role: "student",
    },
    enrollment: {
      id: "enr_001",
      userId: "user_001",
      orderNo: "IMW-20260731-1842",
      buyerName: "김수강",
      buyerEmail: "student@example.com",
      paidAt: "2026.07.31 14:32",
      courseIds: courses.map((course) => course.id),
      emailVerified: true,
      contractSigned: false,
      status: "pending_contract",
    },
    invitations: [invite.publicRecord],
    mailOutbox: [invite.mailRecord],
    contractSignatures: [],
    progress: {},
    submissions: [],
    drm: {
      policy: {
        tokenTtlMinutes: 10,
        maxDevices: 2,
        maxConcurrentStreams: 1,
        watermarkMode: "dynamic_visible",
        captureResponse: "block_if_supported",
      },
      devices: [
        {
          id: "device-macbook-local",
          label: "MacBook Pro · Safari",
          trusted: true,
          lastSeen: "2026.07.31 14:40",
        },
      ],
      activeSession: null,
      licenseLog: [],
    },
  };
}

async function ensureDb() {
  await fsp.mkdir(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    await writeDb(defaultDb());
  }
}

async function readDb() {
  await ensureDb();
  const raw = await fsp.readFile(dbPath, "utf8");
  return JSON.parse(raw);
}

async function writeDb(db) {
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

async function updateDb(mutator) {
  const db = await readDb();
  pruneExpiredSession(db);
  const result = await mutator(db);
  await writeDb(db);
  return result ?? db;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": appUrl,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendOptions(req, res) {
  const origin = req.headers.origin || appUrl;
  const allowOrigin = allowedOrigins.has(origin) ? origin : appUrl;
  res.writeHead(204, {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  res.end();
}

function sendError(res, status, message, details = {}) {
  sendJson(res, status, { error: message, ...details });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, mode: "local-pre-api", dbPath, appUrl, apiUrl });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const db = await updateDb((current) => current);
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/contracts/sign") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!name || !email) throw httpError(400, "이름과 이메일이 필요합니다.");
      if (!body.confirmed) throw httpError(400, "계약 확인 동의가 필요합니다.");
      if (email !== current.enrollment.buyerEmail.toLowerCase()) {
        throw httpError(409, "아임웹 주문 이메일과 서명 이메일이 일치하지 않습니다.");
      }

      current.user.name = name;
      current.user.email = email;
      current.enrollment.contractSigned = true;
      current.enrollment.status = "active";
      current.contractSignatures.unshift({
        id: `contract_${randomUUID()}`,
        userId: current.user.id,
        enrollmentId: current.enrollment.id,
        version: "LMS-CONTRACT-2026.07-A",
        documentHash: sha256("LMS-CONTRACT-2026.07-A:content-protection:watermark:privacy"),
        name,
        email,
        signedAt: formatNow(),
        signatureMethod: "email_otp_plus_checkbox",
        ipAddress: "127.0.0.1",
        userAgent: req.headers["user-agent"] || "local-browser",
      });
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/contracts/reset") {
    const db = await updateDb((current) => {
      current.enrollment.contractSigned = false;
      current.enrollment.status = "pending_contract";
      current.drm.activeSession = null;
      addLicenseLog(current, "session_revoked", "ended", "계약서 상태 초기화로 재생 세션을 종료했습니다.");
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/invitations/resend") {
    const db = await updateDb((current) => {
      current.invitations = current.invitations.map((invite) =>
        invite.usedAt ? invite : { ...invite, status: "revoked", revokedAt: formatNow() },
      );
      const invite = createInviteRecord(current.enrollment.buyerEmail, "운영자 재발송");
      current.invitations.unshift(invite.publicRecord);
      current.mailOutbox.unshift(invite.mailRecord);
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/invite/")) {
    const token = decodeURIComponent(url.pathname.replace("/invite/", ""));
    const db = await updateDb((current) => {
      const tokenHash = sha256(token);
      const invite = current.invitations.find((item) => item.tokenHash === tokenHash && item.status === "sent");
      if (!invite) throw httpError(404, "유효하지 않은 초대 링크입니다.");
      if (new Date(invite.expiresAt).getTime() <= Date.now()) throw httpError(410, "만료된 초대 링크입니다.");
      invite.usedAt = formatNow();
      invite.status = "used";
      current.enrollment.emailVerified = true;
    });
    res.writeHead(302, { Location: `${appUrl}/?invite=accepted` });
    res.end();
    return db;
  }

  if (req.method === "POST" && url.pathname === "/api/playback/sessions") {
    const body = await readJson(req);
    let playbackError = null;
    const r2PlaybackUrl = await generateR2PlaybackUrl(body.courseId, body.chapterId);
    const db = await updateDb((current) => {
      ensureUnlocked(current);
      const course = findCourse(current, body.courseId);
      const chapter = findChapter(course, body.chapterId);
      const policy = current.drm.policy;

      if (current.drm.devices.length > policy.maxDevices) {
        addLicenseLog(
          current,
          "blocked_device_limit",
          "blocked",
          `등록 기기 ${current.drm.devices.length}대가 허용 기기 ${policy.maxDevices}대를 초과했습니다.`,
        );
        playbackError = "등록 기기 수가 초과되어 재생이 차단되었습니다.";
        return;
      }

      if (current.drm.activeSession && policy.maxConcurrentStreams <= 1) {
        addLicenseLog(
          current,
          "session_replaced",
          "ended",
          `${current.drm.activeSession.chapterLabel} 세션을 닫고 ${chapter.label} 세션으로 교체했습니다.`,
        );
      }

      const token = `play_${randomUUID().replaceAll("-", "")}`;
      const expiresAt = new Date(Date.now() + policy.tokenTtlMinutes * 60 * 1000).toISOString();
      const device = current.drm.devices[0];
      device.lastSeen = formatNow();

      current.drm.activeSession = {
        id: `ps_${randomUUID()}`,
        userId: current.user.id,
        courseId: course.id,
        chapterId: chapter.id,
        chapterLabel: chapter.label,
        chapterTitle: chapter.title,
        assetId: course.videoAsset.assetId,
        manifestUrl: r2PlaybackUrl || course.videoAsset.manifestUrl,
        r2Connected: !!r2PlaybackUrl,
        licenseUrl: `${apiUrl}/api/drm/license`,
        tokenHash: sha256(token),
        tokenPreview: `${token.slice(0, 12)}...${token.slice(-6)}`,
        issuedAt: formatNow(),
        expiresAt,
        deviceId: device.id,
        deviceLabel: device.label,
        keySystems: course.videoAsset.keySystems,
        watermarkSubject: `${current.user.name} · ${current.user.email} · ${current.user.memberId}`,
      };

      const key = progressKey(current.user.id, course.id, chapter.id);
      current.progress[key] = Math.max(current.progress[key] || 0, 45);
      addLicenseLog(current, "license_issued", "allowed", `${chapter.label} DRM 라이선스와 서명 재생 URL을 발급했습니다.`);
    });
    if (playbackError) {
      sendJson(res, 409, { error: playbackError, state: toClientState(db) });
      return;
    }
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/progress/complete") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      ensureUnlocked(current);
      const course = findCourse(current, body.courseId);
      const chapter = findChapter(course, body.chapterId);
      current.progress[progressKey(current.user.id, course.id, chapter.id)] = 100;
      if (current.drm.activeSession?.chapterId === chapter.id) {
        current.drm.activeSession = null;
      }
      addLicenseLog(current, "session_completed", "ended", `${chapter.label} 시청 완료로 재생 세션을 종료했습니다.`);
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/submissions") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      ensureUnlocked(current);
      const course = findCourse(current, body.courseId);
      const chapter = findChapter(course, body.chapterId);
      const text = String(body.text || "").trim();
      if (!text) throw httpError(400, "과제 내용이 필요합니다.");

      current.submissions.unshift({
        id: `sub_${randomUUID()}`,
        userId: current.user.id,
        courseId: course.id,
        chapterId: chapter.id,
        chapterLabel: chapter.label,
        chapterTitle: chapter.title,
        studentName: current.user.name,
        studentEmail: current.user.email,
        text,
        fileName: String(body.fileName || "").trim(),
        status: "feedback_requested",
        createdAt: formatNow(),
        feedback: "",
        feedbackAt: "",
      });
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/submissions/feedback") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      const submission = current.submissions.find((item) => item.id === body.submissionId);
      if (!submission) throw httpError(404, "제출 과제를 찾을 수 없습니다.");
      submission.feedback = String(body.feedback || "검토 완료했습니다. 다음 챕터에서 반영 내용을 확인해 주세요.").trim();
      submission.status = "feedback_sent";
      submission.feedbackAt = formatNow();
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/drm/sessions/revoke") {
    const db = await updateDb((current) => {
      if (current.drm.activeSession) {
        addLicenseLog(current, "session_revoked", "ended", `${current.drm.activeSession.chapterLabel} 재생 세션을 운영자가 종료했습니다.`);
      }
      current.drm.activeSession = null;
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/drm/license") {
    const db = await updateDb((current) => {
      ensureUnlocked(current);
      if (!current.drm.activeSession) throw httpError(403, "활성 재생 세션이 없습니다.");
      addLicenseLog(current, "license_checked", "allowed", `${current.drm.activeSession.chapterLabel} 라이선스 요청을 로컬 서버가 승인했습니다.`);
    });
    sendJson(res, 200, {
      ok: true,
      mode: "local-license-placeholder",
      activeSession: db.drm.activeSession,
      nextStep: "상용 DRM 라이선스 서버로 프록시 연결",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/drm/devices/simulate") {
    const db = await updateDb((current) => {
      const nextNumber = current.drm.devices.length + 1;
      const overLimit = nextNumber > current.drm.policy.maxDevices;
      const device = {
        id: `device-local-${randomUUID().slice(0, 8)}`,
        label: `새 기기 ${nextNumber} · Chrome`,
        trusted: !overLimit,
        lastSeen: formatNow(),
      };
      current.drm.devices.push(device);
      addLicenseLog(
        current,
        "device_registered",
        overLimit ? "blocked" : "allowed",
        overLimit ? `${device.label} 등록으로 기기 제한을 초과했습니다.` : `${device.label} 기기를 등록했습니다.`,
      );
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/drm/devices/reset") {
    const db = await updateDb((current) => {
      current.drm.devices = [
        {
          id: "device-macbook-local",
          label: "MacBook Pro · Safari",
          trusted: true,
          lastSeen: formatNow(),
        },
      ];
      current.drm.activeSession = null;
      addLicenseLog(current, "devices_reset", "ended", "등록 기기를 기본 로컬 기기 1대로 초기화했습니다.");
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/imweb/webhooks/order-paid") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      const buyerEmail = String(body.buyerEmail || current.enrollment.buyerEmail).trim().toLowerCase();
      const buyerName = String(body.buyerName || current.enrollment.buyerName).trim();
      const courseIds = Array.isArray(body.courseIds) && body.courseIds.length ? body.courseIds : current.enrollment.courseIds;

      current.enrollment.orderNo = String(body.orderNo || current.enrollment.orderNo).trim();
      current.enrollment.buyerEmail = buyerEmail;
      current.enrollment.buyerName = buyerName;
      current.enrollment.courseIds = courseIds;
      current.enrollment.emailVerified = true;
      current.enrollment.contractSigned = false;
      current.enrollment.status = "pending_contract";
      current.user.name = buyerName;
      current.user.email = buyerEmail;
      current.drm.activeSession = null;

      const invite = createInviteRecord(buyerEmail, "아임웹 결제 완료 웹훅");
      current.invitations.unshift(invite.publicRecord);
      current.mailOutbox.unshift(invite.mailRecord);
      addLicenseLog(current, "imweb_order_paid", "allowed", `${current.enrollment.orderNo} 주문으로 수강권 대기 상태를 만들었습니다.`);
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/imweb/webhooks/refund") {
    const body = await readJson(req);
    const db = await updateDb((current) => {
      const orderNo = String(body.orderNo || "").trim();
      if (orderNo && orderNo !== current.enrollment.orderNo) throw httpError(404, "환불 처리할 주문번호를 찾을 수 없습니다.");
      current.enrollment.status = "refunded";
      current.enrollment.contractSigned = false;
      current.drm.activeSession = null;
      addLicenseLog(current, "imweb_refund", "ended", `${current.enrollment.orderNo} 환불 웹훅으로 수강권과 재생 세션을 정지했습니다.`);
    });
    sendJson(res, 200, toClientState(db));
    return;
  }

  // R2 어드민 엔드포인트
  if (req.method === "GET" && url.pathname === "/api/admin/r2/status") {
    const connected = !!r2;
    let bucketOk = false;
    let videoCount = 0;
    if (r2) {
      try {
        const list = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "videos/", MaxKeys: 100 }));
        bucketOk = true;
        videoCount = (list.Contents || []).length;
      } catch {}
    }
    sendJson(res, 200, {
      r2Connected: connected,
      bucketOk,
      bucket: R2_BUCKET,
      endpoint: R2_ENDPOINT || null,
      videoCount,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/r2/videos") {
    if (!r2) { sendError(res, 503, "R2 미연결. 환경변수를 확인하세요."); return; }
    const list = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "videos/", MaxKeys: 200 }));
    const files = (list.Contents || []).map((obj) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
      courseId: obj.Key.split("/")[1] || "",
      chapterId: obj.Key.split("/")[2] || "",
    }));
    sendJson(res, 200, { bucket: R2_BUCKET, files });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/r2/upload-url") {
    if (!r2) { sendError(res, 503, "R2 미연결. 환경변수를 확인하세요."); return; }
    const body = await readJson(req);
    if (!body.courseId || !body.chapterId) { sendError(res, 400, "courseId와 chapterId가 필요합니다."); return; }
    const result = await generateR2UploadUrl(body.courseId, body.chapterId, body.contentType || "video/mp4");
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/demo/reset") {
    const db = defaultDb();
    await writeDb(db);
    sendJson(res, 200, toClientState(db));
    return;
  }

  sendError(res, 404, "API 경로를 찾을 수 없습니다.");
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const requested = path.normalize(path.join(rootDir, pathname));
  if (!requested.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(requested, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(requested).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "no-cache",
    });
    res.end(data);
  });
}

function toClientState(db) {
  const latestContract = db.contractSignatures[0] || null;
  const latestInvite = db.invitations[0] || null;
  return {
    courses: db.courses,
    user: db.user,
    enrollment: db.enrollment,
    contract: latestContract,
    progress: db.progress,
    submissions: db.submissions,
    drm: db.drm,
    invitations: db.invitations,
    latestInvite,
    mailOutbox: db.mailOutbox,
    server: {
      mode: r2 ? "r2-connected" : "local-pre-api",
      readyForExternalApis: true,
      r2Connected: !!r2,
      r2Bucket: R2_BUCKET,
      missingExternalConnections: [
        ...(r2 ? [] : ["Cloudflare R2 (환경변수 미설정)"]),
        "아임웹 주문 웹훅",
        "메일 발송 API",
        "상용 DRM 라이선스 서버",
      ],
    },
  };
}

function createInviteRecord(email, reason) {
  const token = `invite_${randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const publicRecord = {
    id: `inv_${randomUUID()}`,
    email,
    tokenHash: sha256(token),
    tokenPreview: `${token.slice(0, 14)}...${token.slice(-6)}`,
    localInviteUrl: `${apiUrl}/invite/${token}`,
    status: "sent",
    reason,
    sentAt: formatNow(),
    expiresAt,
    usedAt: "",
  };

  const mailRecord = {
    id: `mail_${randomUUID()}`,
    to: email,
    subject: "[카니발 라이언 LMS] 강의실 초대 링크",
    createdAt: formatNow(),
    deliveryStatus: "local_outbox",
    preview: `초대 링크: ${publicRecord.localInviteUrl}`,
  };

  return { publicRecord, mailRecord };
}

function ensureUnlocked(db) {
  if (!db.enrollment.emailVerified) throw httpError(403, "이메일 인증이 필요합니다.");
  if (!db.enrollment.contractSigned) throw httpError(403, "계약서 서명이 필요합니다.");
  if (db.enrollment.status !== "active") throw httpError(403, "활성 수강권이 필요합니다.");
}

function findCourse(db, courseId) {
  const course = db.courses.find((item) => item.id === courseId);
  if (!course || !db.enrollment.courseIds.includes(course.id)) throw httpError(404, "수강 가능한 강의를 찾을 수 없습니다.");
  return course;
}

function findChapter(course, chapterId) {
  const chapter = course.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw httpError(404, "챕터를 찾을 수 없습니다.");
  return chapter;
}

function pruneExpiredSession(db) {
  const session = db.drm?.activeSession;
  if (!session) return;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    addLicenseLog(db, "session_expired", "ended", `${session.chapterLabel} 재생 세션이 만료되었습니다.`);
    db.drm.activeSession = null;
  }
}

function addLicenseLog(db, type, status, detail) {
  const labels = {
    license_issued: "DRM 라이선스 발급",
    blocked_device_limit: "기기 제한 차단",
    session_completed: "시청 완료",
    session_replaced: "세션 교체",
    session_revoked: "세션 수동 종료",
    session_expired: "세션 만료",
    license_checked: "라이선스 요청 승인",
    device_registered: "기기 등록",
    devices_reset: "기기 초기화",
    imweb_order_paid: "아임웹 결제 웹훅",
    imweb_refund: "아임웹 환불 웹훅",
  };

  const statusLabels = {
    allowed: "허용",
    blocked: "차단",
    ended: "종료",
  };

  db.drm.licenseLog.unshift({
    id: `log_${randomUUID()}`,
    type,
    title: labels[type] || "보안 이벤트",
    status,
    statusLabel: statusLabels[status] || status,
    detail,
    createdAt: formatNow(),
  });
  db.drm.licenseLog = db.drm.licenseLog.slice(0, 40);
}

function progressKey(userId, courseId, chapterId) {
  return `${userId}:${courseId}:${chapterId}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

function formatNow() {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
  try {
    if (req.method === "OPTIONS") {
      sendOptions(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/invite/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendError(res, error.status || 500, error.message || "서버 오류가 발생했습니다.");
  }
});

ensureDb()
  .then(() => {
    server.listen(port, bindHost, () => {
      console.log(`카니발 라이언 LMS server: ${apiUrl}/`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
