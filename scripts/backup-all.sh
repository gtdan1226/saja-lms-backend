#!/bin/bash
# LMS 자동 백업 스크립트 (30분마다 실행)
# 저장 위치: ~/Library/CloudStorage/Dropbox/Work/Shuffleland/LMS/BACKUP/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_ROOT="$HOME/Library/CloudStorage/Dropbox/Work/Shuffleland/LMS/BACKUP"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# .env 로드
ENV_FILE="$PROJECT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

echo "=== LMS 백업 시작: $TIMESTAMP ==="

# ── 1. Supabase DB 백업 ─────────────────────────────────────
echo "[Supabase] DB 백업 중..."
SUPA_DIR="$BACKUP_ROOT/Supabase"
mkdir -p "$SUPA_DIR"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "  [SKIP] SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음"
  echo "  → $PROJECT_DIR/.env 파일에 키를 추가하세요"
else
  curl -s \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_URL/rest/v1/lms_state?id=eq.main&select=*" \
    -o "$SUPA_DIR/db_$TIMESTAMP.json"

  # 요약
  SUMMARY=$(python3 -c "
import json, sys
with open('$SUPA_DIR/db_$TIMESTAMP.json') as f:
    d = json.load(f)
data = d[0].get('data', {}) if d else {}
users = len(data.get('users', []))
enr = len(data.get('enrollments', []))
sub = len(data.get('submissions', []))
updated = d[0].get('updated_at', '?') if d else '?'
print(f'사용자:{users} 수강:{enr} 제출:{sub} | DB업데이트:{updated}')
" 2>/dev/null || echo "파싱 실패")
  echo "  ✓ db_$TIMESTAMP.json — $SUMMARY"

  # 30일 이상 된 파일 삭제
  find "$SUPA_DIR" -name "db_*.json" -mtime +30 -delete 2>/dev/null || true
fi

# ── 2. Railway (백엔드 코드) 백업 ────────────────────────────
echo "[Railway] 백엔드 코드 백업 중..."
RAILWAY_DIR="$BACKUP_ROOT/Railway"
mkdir -p "$RAILWAY_DIR"

cd "$PROJECT_DIR"
BACKEND_COMMIT=$(git log --oneline -1 2>/dev/null || echo "git 없음")
{
  echo "=== 백업 시각: $TIMESTAMP ==="
  echo "=== 최근 커밋 ==="
  git log --oneline -10 2>/dev/null
  echo ""
  echo "=== 현재 상태 ==="
  git status --short 2>/dev/null
} > "$RAILWAY_DIR/git_log_$TIMESTAMP.txt"

# 코드 스냅샷 zip (node_modules, data, backups 제외)
zip -q -r "$RAILWAY_DIR/code_$TIMESTAMP.zip" . \
  --exclude "*/node_modules/*" \
  --exclude "*/data/*" \
  --exclude "*/backups/*" \
  --exclude "*/.git/*" \
  --exclude "*/.env" 2>/dev/null || true
echo "  ✓ code_$TIMESTAMP.zip — $BACKEND_COMMIT"

# 30일 이상 된 파일 삭제
find "$RAILWAY_DIR" -name "*.txt" -mtime +30 -delete 2>/dev/null || true
find "$RAILWAY_DIR" -name "*.zip" -mtime +30 -delete 2>/dev/null || true

# ── 3. Vercel (프론트엔드 코드) 백업 ────────────────────────
echo "[Vercel] 프론트엔드 코드 백업 중..."
VERCEL_DIR="$BACKUP_ROOT/Vercel"
mkdir -p "$VERCEL_DIR"

FRONTEND_DIR=$(find "$HOME" /private/tmp -path "*/saja-lms-frontend" -type d 2>/dev/null | grep -v ".git" | head -1)
if [ -n "$FRONTEND_DIR" ]; then
  FRONTEND_COMMIT=$(cd "$FRONTEND_DIR" && git log --oneline -1 2>/dev/null || echo "git 없음")
  {
    echo "=== 백업 시각: $TIMESTAMP ==="
    echo "=== 최근 커밋 ==="
    cd "$FRONTEND_DIR" && git log --oneline -10 2>/dev/null
    echo ""
    echo "=== 현재 상태 ==="
    git status --short 2>/dev/null
  } > "$VERCEL_DIR/git_log_$TIMESTAMP.txt"

  zip -q -r "$VERCEL_DIR/code_$TIMESTAMP.zip" "$FRONTEND_DIR" \
    --exclude "*/.git/*" 2>/dev/null || true
  echo "  ✓ code_$TIMESTAMP.zip — $FRONTEND_COMMIT"

  find "$VERCEL_DIR" -name "*.txt" -mtime +30 -delete 2>/dev/null || true
  find "$VERCEL_DIR" -name "*.zip" -mtime +30 -delete 2>/dev/null || true
else
  echo "  [SKIP] saja-lms-frontend 디렉토리 없음"
fi

# ── 4. 회원 계약서 백업 ──────────────────────────────────────
echo "[계약서] 서명 백업 중..."
CONTRACT_DIR="$BACKUP_ROOT/회원 계약서"
mkdir -p "$CONTRACT_DIR"

LATEST_SUPA=$(ls -t "$SUPA_DIR"/db_*.json 2>/dev/null | head -1)
if [ -n "$LATEST_SUPA" ]; then
  python3 << 'PYEOF'
import json, os, sys

BACKUP_ROOT = os.path.expanduser("~/Library/CloudStorage/Dropbox/Work/Shuffleland/LMS/BACKUP")
CONTRACT_DIR = os.path.join(BACKUP_ROOT, "회원 계약서")
SUPA_DIR    = os.path.join(BACKUP_ROOT, "Supabase")

latest = sorted(f for f in os.listdir(SUPA_DIR) if f.startswith("db_") and f.endswith(".json"))
if not latest:
    sys.exit(0)

with open(os.path.join(SUPA_DIR, latest[-1]), encoding="utf-8") as f:
    rows = json.load(f)
data = rows[0].get("data", {}) if rows else {}
contracts = data.get("contractSignatures", [])
users = {u["id"]: u for u in data.get("users", [])}
enrollments = {e["userId"]: e for e in data.get("enrollments", [])}
courses = {c["id"]: c for c in data.get("courses", [])}

new_count = 0
for c in contracts:
    uid = c.get("userId", "unknown")
    cid = c.get("id", uid)
    filename = os.path.join(CONTRACT_DIR, f"contract_{cid}.html")
    if os.path.exists(filename):
        continue

    user = users.get(uid, {})
    enr = enrollments.get(uid, {})
    enrolled_courses = [courses[crs_id]["title"] for crs_id in (enr.get("courseIds") or []) if crs_id in courses]
    course_list_html = "".join(f"<li>{t}</li>" for t in enrolled_courses) or "<li>(정보 없음)</li>"
    signed_at = c.get("signedAt", "")
    name = c.get("name", user.get("name", ""))
    email = c.get("email", user.get("email", ""))
    ip = c.get("ipAddress", "")
    doc_ver = c.get("version", "LMS-CONTRACT-2026.07-A")
    doc_hash = c.get("documentHash", "")
    member_id = user.get("memberId", "")

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>수강 계약서 — {name}</title>
<style>
  body {{ font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 760px; margin: 48px auto; color: #1a1a1a; line-height: 1.7; }}
  .header {{ border-bottom: 3px solid #137a70; padding-bottom: 16px; margin-bottom: 32px; display: flex; align-items: center; gap: 12px; }}
  .logo {{ background: #137a70; color: #fff; font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 6px; }}
  h1 {{ font-size: 22px; margin: 0; }}
  h3 {{ color: #137a70; margin-top: 24px; }}
  .info-table {{ width: 100%; border-collapse: collapse; margin: 24px 0; }}
  .info-table td {{ padding: 10px 14px; border: 1px solid #ddd; }}
  .info-table td:first-child {{ background: #f5f5f5; font-weight: 600; width: 140px; }}
  .contract-box {{ background: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }}
  .contract-box h3 {{ margin-top: 0; }}
  .sig-box {{ border: 2px solid #137a70; border-radius: 8px; padding: 20px 24px; margin-top: 32px; background: #f0faf9; }}
  .sig-box .sig-label {{ font-size: 13px; color: #555; }}
  .sig-box .sig-value {{ font-size: 16px; font-weight: 700; margin: 4px 0 12px; }}
  .hash {{ font-family: monospace; font-size: 11px; color: #888; word-break: break-all; }}
  .footer {{ margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #aaa; text-align: center; }}
</style>
</head>
<body>
<div class="header">
  <span class="logo">카니발 라이언 LMS</span>
  <h1>수강 계약서 (최종 서명본)</h1>
</div>

<table class="info-table">
  <tr><td>성명</td><td>{name}</td></tr>
  <tr><td>이메일</td><td>{email}</td></tr>
  <tr><td>회원 ID</td><td>{member_id}</td></tr>
  <tr><td>수강 강의</td><td><ul style="margin:0;padding-left:18px">{course_list_html}</ul></td></tr>
</table>

<div class="contract-box">
  <h3>콘텐츠 보호 정책</h3>
  <p>본 강의는 DRM 기술로 보호됩니다. 녹화, 캡처, 재배포 시 법적 책임을 질 수 있습니다.</p>
  <h3>수강 조건</h3>
  <p>수강권은 1인 전용이며 타인과 공유할 수 없습니다. 최대 2대의 기기에서 이용 가능합니다.</p>
  <h3>환불 규정</h3>
  <p>수강 시작 후 7일 내에 환불이 가능합니다. 이후에는 환불이 불가합니다.</p>
  <h3>개인정보 처리</h3>
  <p>성명과 이메일은 수강 관리 및 수료증 발급에만 사용됩니다.</p>
</div>

<div class="sig-box">
  <p style="margin:0 0 16px;font-weight:700">위 내용을 모두 읽었으며 동의합니다. (전자 서명 완료)</p>
  <div class="sig-label">서명자</div>
  <div class="sig-value">{name} ({email})</div>
  <div class="sig-label">서명 일시</div>
  <div class="sig-value">{signed_at}</div>
  <div class="sig-label">서명 방식</div>
  <div class="sig-value">체크박스 동의 (checkbox_agreement)</div>
  <div class="sig-label">접속 IP</div>
  <div class="sig-value">{ip}</div>
</div>

<div style="margin-top:24px;font-size:12px;color:#888">
  <b>문서 버전:</b> {doc_ver}<br>
  <b>문서 해시 (SHA-256):</b><br>
  <span class="hash">{doc_hash}</span>
</div>

<div class="footer">
  카니발 라이언 LMS · Shuffleland · 자동 백업 생성 문서
</div>
</body>
</html>"""

    with open(filename, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  ✓ 계약서: contract_{cid}.html — {name} ({signed_at})")
    new_count += 1

if new_count == 0:
    print("  ─ 신규 계약서 없음")
PYEOF
else
  echo "  [SKIP] Supabase 백업 파일 없음 (Supabase 백업이 먼저 실행되어야 합니다)"
fi

echo ""
echo "✓ 백업 완료: $BACKUP_ROOT"
echo "  Supabase/ Railway/ Vercel/ 회원 계약서/"
