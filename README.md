# 친구 위치 (Friend Map)

같은 방 코드를 입력한 친구끼리 지도에서 서로 위치를 보는 사이트입니다.
Cloudflare Pages + Pages Functions + D1(무료)로 동작합니다.

- 웹페이지: 지금 보내기 / 열어둔 동안 자동 공유
- 화면 꺼도 공유: OwnTracks 앱(iOS·Android, 무료)이 백그라운드에서 `/api/owntracks`로 전송
- 7일 지난 위치는 자동으로 숨김, "내 위치 삭제" 가능

## 폴더 구조

```
public/index.html          지도 화면 (Leaflet + OpenStreetMap)
functions/_shared.js       D1 저장/조회 공용 코드
functions/api/locations.js GET  친구 위치 목록
functions/api/update.js    POST 웹에서 위치 보내기
functions/api/leave.js     POST 내 위치 삭제
functions/api/owntracks.js POST OwnTracks 앱 수신
```

## 배포 순서

1. 이 폴더를 GitHub 저장소(예: `KWJ-DB/friendmap`)에 올리기
2. Cloudflare 대시보드 → **Storage & Databases → D1** → 데이터베이스 만들기 (이름 예: `friendmap`)
   - 테이블은 첫 요청 때 자동으로 만들어져서 SQL 입력 필요 없음
3. **Workers & Pages → 만들기 → Pages → Git에 연결** → 저장소 선택
   - 프레임워크: 없음
   - 빌드 명령: 비워두기
   - 빌드 출력 디렉터리: `public`
4. 배포 후 프로젝트 **설정 → 바인딩 → D1 데이터베이스 추가**
   - 변수 이름: `DB` (꼭 대문자 DB)
   - 데이터베이스: 2번에서 만든 것
5. **배포 → 다시 배포(Retry deployment)** 해야 바인딩이 적용됨
6. `https://프로젝트이름.pages.dev` 접속

## 화면 꺼도 공유 (OwnTracks)

사이트에서 "꺼도 공유" 버튼을 누르면 입력할 값이 자동으로 나옵니다.

| 항목 | 값 |
|---|---|
| Mode | HTTP |
| URL | `https://프로젝트이름.pages.dev/api/owntracks` |
| UserID | 사이트에 입력한 이름 |
| Password | 방 코드 |
| DeviceID | phone |

위치 권한은 **항상 허용**, 모니터링 모드는 Significant(배터리 절약) 또는 Move(자주 전송).

## 참고

- 방 코드는 서버에 그대로 저장하지 않고 SHA-256 해시로만 구분합니다. 코드를 아는 사람은 누구나 그 방을 볼 수 있으니 길고 안 겹치게 정하세요.
- D1 무료 한도(하루 쓰기 10만 행, 읽기 500만 행)라 친구 몇 명 쓰기엔 충분합니다.
- 웹 자동 공유는 30초 이상 간격 + 25m 이상 이동 시, 또는 5분마다 전송합니다.
