# LMS DRM 서버/API 연결 계획

## 현재 로컬 프로토타입에서 구현된 흐름

1. 학생이 LMS에 입장한다.
2. 아임웹 주문 이메일과 LMS 계정 이메일이 일치하는지 확인한다.
3. 계약서 전자서명이 완료되어야 강의실이 열린다.
4. 학생이 `보안 재생 시작`을 누르면 로컬 서버가 재생 세션을 발급한다.
5. 재생 세션에는 영상 자산 ID, manifest URL, 라이선스 서버 URL, 토큰 해시, 만료 시각, 기기 정보가 들어간다.
6. 보안 화면에서 현재 세션, 등록 기기, 라이선스 로그, 워터마크 정책을 확인한다.
7. 모든 상태는 `data/db.json` 파일 DB에 저장된다.

## 실서비스에서 필요한 핵심 API

### POST `/api/playback/sessions`

학생이 영상을 재생하려고 할 때 호출한다.

서버 검증:

- 로그인 세션이 유효한가
- 아임웹 주문번호와 수강권이 연결되어 있는가
- 계약서 최신 필수 버전에 서명했는가
- 요청한 강의와 챕터에 접근 권한이 있는가
- 등록 기기 수와 동시 재생 수가 정책 안에 있는가

응답:

```json
{
  "playbackSessionId": "ps_...",
  "manifestUrl": "https://cdn.example.com/course/manifest.mpd?token=...",
  "licenseUrl": "https://lms.example.com/api/drm/license",
  "expiresAt": "2026-07-31T06:30:00.000Z",
  "watermark": {
    "name": "김수강",
    "email": "student@example.com",
    "memberId": "LMS-260731-001"
  }
}
```

### POST `/api/drm/license`

DRM 플레이어가 라이선스를 요청할 때 호출한다.

서버 검증:

- 재생 세션이 만료되지 않았는가
- 토큰 해시가 서버에 저장된 값과 일치하는가
- 요청 기기가 등록 기기와 일치하는가
- 같은 계정의 동시 재생이 제한을 넘지 않았는가

현재 로컬 빌드에서는 이 엔드포인트가 플레이스홀더 라이선스 승인을 반환한다. 다음 단계에서 상용 DRM 라이선스 서버와 연결한다.

### POST `/api/devices/register`

새 기기를 등록할 때 호출한다. 기기 초과 시 기존 기기 해제 또는 관리자 승인 흐름이 필요하다.

### POST `/api/imweb/webhooks/order-paid`

아임웹 결제 완료 웹훅을 받는다. 서버가 아임웹 주문 API로 주문을 다시 조회한 뒤 수강권을 생성한다.

현재 로컬 빌드에서는 요청 본문으로 들어온 주문 정보를 파일 DB에 반영하고 초대 메일 발송함에 기록한다.

### POST `/api/imweb/webhooks/refund`

환불 또는 취소 웹훅을 받는다. 해당 주문번호에 연결된 수강권과 재생 세션을 정지한다.

현재 로컬 빌드에서는 주문번호가 맞으면 수강권을 `refunded` 상태로 바꾸고 활성 재생 세션을 종료한다.

## DB에 남겨야 하는 보안 기록

- `playback_sessions`
- `drm_license_requests`
- `registered_devices`
- `watermark_events`
- `contract_signatures`
- `enrollments`
- `imweb_orders`

## 다음 구현 순서

1. 로컬 앱을 실제 백엔드가 있는 구조로 분리한다.
2. 로그인, 수강권, 계약서 서명 상태를 DB에 저장한다.
3. 재생 세션 발급 API를 만든다.
4. HLS/DASH 영상 manifest를 비공개 저장소/CDN과 연결한다.
5. 상용 DRM 라이선스 서버 또는 DRM 지원 VOD 플랫폼을 붙인다.
6. 아임웹 결제 완료/환불 웹훅을 연결한다.
