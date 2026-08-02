#!/usr/bin/env node
/**
 * DB 백업 스크립트
 * 실행: node scripts/backup-db.js
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * backups/db_YYYYMMDD_HHMMSS.json 으로 저장
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  console.error("사용법: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup-db.js");
  process.exit(1);
}

async function backup() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabase
    .from("lms_state")
    .select("id, data, updated_at")
    .eq("id", "main")
    .single();

  if (error) {
    console.error("Supabase 읽기 실패:", error.message);
    process.exit(1);
  }

  const dir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `db_${ts}.json`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + "\n", "utf8");

  // 사용자 수, 강의 수, 등록 수 요약
  const db = data.data || {};
  const userCount = (db.users || []).length;
  const courseCount = (db.courses || []).length;
  const enrollmentCount = (db.enrollments || []).length;
  const submissionCount = (db.submissions || []).length;

  console.log(`✓ 백업 완료: backups/${filename}`);
  console.log(`  사용자: ${userCount}명 | 강의: ${courseCount}개 | 수강등록: ${enrollmentCount}개 | 제출: ${submissionCount}개`);
  console.log(`  DB 최종 업데이트: ${data.updated_at}`);
}

backup().catch((e) => { console.error(e); process.exit(1); });
