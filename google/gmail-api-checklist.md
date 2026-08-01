# Gmail API 연결 체크리스트

메일 발송은 Railway 백엔드에서만 실행합니다. Vercel 프론트에는 Google 비밀키를 넣지 않습니다.

## Google Cloud

1. 새 프로젝트를 만들거나 기존 프로젝트를 선택합니다.
2. `Gmail API`를 활성화합니다.
3. OAuth consent screen을 설정합니다.
4. OAuth Client를 만듭니다.
5. 발송할 Google 계정으로 OAuth 승인을 진행합니다.
6. `refresh_token`을 확보합니다.

## Railway 환경변수

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GMAIL_SENDER_EMAIL=
```

## 발송 메일 종류

```text
초대 메일
이메일 인증 코드
계약서 서명 완료
과제 제출 알림
피드백 등록 알림
```

## 주의

```text
refresh_token은 절대 프론트 코드나 Vercel에 넣지 않습니다.
메일 발송 실패 시 수강권 생성은 유지하고, mail_outbox에 실패 기록을 남깁니다.
초대 링크는 1회용/만료형으로 유지합니다.
```
