const baseUrl = process.argv[2] || "http://127.0.0.1:8941";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${payload.error || response.statusText}`);
  }
  return payload;
}

async function run() {
  await request("/api/demo/reset", { method: "POST", body: {} });
  const initial = await request("/api/state");
  assert(initial.enrollment.status === "pending_contract", "initial enrollment is pending");

  const signed = await request("/api/contracts/sign", {
    method: "POST",
    body: {
      name: "김수강",
      email: "student@example.com",
      confirmed: true,
    },
  });
  assert(signed.enrollment.status === "active", "contract activates enrollment");

  const playback = await request("/api/playback/sessions", {
    method: "POST",
    body: { courseId: "creator-ai", chapterId: "ai-01" },
  });
  assert(playback.drm.activeSession, "playback session is issued");

  const license = await request("/api/drm/license", { method: "POST", body: {} });
  assert(license.ok, "local drm license placeholder responds");

  const submitted = await request("/api/submissions", {
    method: "POST",
    body: {
      courseId: "creator-ai",
      chapterId: "ai-01",
      text: "스모크 테스트 과제입니다.",
      fileName: "test.pdf",
    },
  });
  assert(submitted.submissions.length === 1, "submission is stored");

  const feedback = await request("/api/admin/submissions/feedback", {
    method: "POST",
    body: {
      submissionId: submitted.submissions[0].id,
      feedback: "스모크 테스트 피드백입니다.",
    },
  });
  assert(feedback.submissions[0].status === "feedback_sent", "feedback is stored");

  await request("/api/invitations/resend", { method: "POST", body: {} });
  await request("/api/drm/devices/simulate", { method: "POST", body: {} });
  await request("/api/drm/devices/reset", { method: "POST", body: {} });
  await request("/api/demo/reset", { method: "POST", body: {} });

  console.log("Smoke test passed");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
