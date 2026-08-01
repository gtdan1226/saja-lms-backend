# 카니발 라이언 LMS 로컬 서버 빌드

이 폴더는 외부 API 연결 직전 단계까지 구현된 카니발 라이언 LMS입니다.

## 실행

```bash
node server.js --port 8941
```

브라우저에서 여세요.

```text
http://127.0.0.1:8941/
```

## 포함된 기능

- 로컬 서버와 파일 DB
- 아임웹 결제 완료/환불 웹훅 자리
- 구매자 이메일 기반 수강권 원장
- 1회용 초대 링크 재발송 시뮬레이션
- 계약서 전자서명 게이트
- 강의실 여러 개와 챕터별 진도
- 과제 제출과 운영자 피드백 처리
- DRM 재생 세션 발급 시뮬레이션
- 로컬 DRM 라이선스 승인 자리
- 등록 기기 제한과 보안 로그
- 동적 워터마크 표시

## 로컬 DB

서버가 처음 실행될 때 아래 파일이 자동 생성됩니다.

```text
data/db.json
```

앱의 `초기 상태` 버튼을 누르면 기본 데이터로 돌아갑니다.

## 점검

서버를 켠 뒤 별도 터미널에서 실행하세요.

```bash
node smoke-test.js http://127.0.0.1:8941
```

## Railway 백엔드 배포

Railway 프로젝트의 Root Directory를 이 폴더로 잡고 실행합니다.

```text
outputs/lms-local
```

Start Command:

```bash
node server.js
```

Healthcheck Path:

```text
/api/health
```

필수 환경변수:

```text
APP_URL=https://lms.내도메인.com
API_URL=https://api-lms.내도메인.com
CORS_ORIGINS=https://lms.내도메인.com
BIND_HOST=0.0.0.0
```

## Vercel 프론트 배포

Vercel 프로젝트의 Root Directory도 이 폴더로 잡습니다.

```text
outputs/lms-local
```

Build Command:

```bash
npm run build
```

Output Directory:

```text
.
```

Vercel 환경변수:

```text
VITE_API_URL=https://api-lms.내도메인.com
```

Vercel에는 Supabase service role key, Gmail secret, R2 secret을 넣지 않습니다.

## 연결 준비 파일

```text
.env.example
supabase/schema.sql
cloudflare/r2-cors.json
google/gmail-api-checklist.md
railway.json
vercel.json
```

## 외부 API 연결 전 남은 항목

- 아임웹 웹훅 서명 검증
- 아임웹 주문 상세 조회 API
- 실제 메일 발송 서비스
- 비공개 VOD 저장소와 CDN
- 상용 DRM 라이선스 서버
- 운영 배포용 DB
