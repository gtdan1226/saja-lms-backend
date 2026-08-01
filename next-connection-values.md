# 다음 연결에 필요한 값

아래 값을 준비하면 바로 연결할 수 있습니다. 비밀키는 이 문서에 저장하지 말고 각 서비스 대시보드의 환경변수에만 넣습니다.

## 1. 도메인

```text
기본 도메인:
LMS 프론트 서브도메인: lms.
API 서브도메인: api-lms.
미디어 서브도메인: media-lms.
```

## 2. Cloudflare

```text
R2 bucket 이름: carnival-lion-lms-videos
R2 endpoint:
R2 access key id:
R2 secret access key:
```

## 3. Supabase

```text
Project URL:
service_role key:
anon key:
```

실행할 SQL:

```text
supabase/schema.sql
```

## 4. Gmail API

```text
Google client id:
Google client secret:
Google refresh token:
발송 Gmail 주소:
```

## 5. Railway

```text
Root Directory: outputs/lms-local
Start Command: node server.js
Healthcheck Path: /api/health
Custom Domain: api-lms.내도메인.com
```

환경변수:

```text
APP_URL=https://lms.내도메인.com
API_URL=https://api-lms.내도메인.com
CORS_ORIGINS=https://lms.내도메인.com
BIND_HOST=0.0.0.0
```

## 6. Vercel

```text
Root Directory: outputs/lms-local
Build Command: npm run build
Output Directory: .
Custom Domain: lms.내도메인.com
```

환경변수:

```text
VITE_API_URL=https://api-lms.내도메인.com
```

## 7. 아임웹

```text
결제 완료 웹훅:
https://api-lms.내도메인.com/api/imweb/webhooks/order-paid

환불/취소 웹훅:
https://api-lms.내도메인.com/api/imweb/webhooks/refund
```
