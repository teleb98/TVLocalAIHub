# Hermes TV Demo — 설정 가이드

## 시스템 구성

```
[Samsung TV 브라우저/웹앱]  --ws/wss-->  [Mac mini :3000]  --http-->  [Ollama :11434]
```

TV는 Mac mini의 주소(192.168.0.77:3000)로 접속만 하면 됩니다.
**TV의 IP 주소는 몰라도 됩니다** — Mac mini가 TV에 먼저 접속할 일이 없기 때문입니다.

---

## 1단계: Mac mini — Bridge Server 설치

```bash
cd ~/hermes-tv-demo
npm install

# 모델명 확인 후 bridge-server.js 수정
ollama list
# 예: qwen2.5:7b → CONFIG.MODEL = "qwen2.5:7b" (이미 반영됨)

node bridge-server.js
```

정상 실행 시 출력:
```
🦌 Hermes TV Bridge Server 시작
   Local : http://localhost:3000
   LAN   : http://192.168.0.77:3000
   모델  : qwen2.5:7b
```

헬스체크:
```bash
curl http://localhost:3000/health
# {"status":"ok","model":"qwen2.5:7b","ts":...}
```

---

## 2단계: TV에서 접속하기 (TV의 IP를 몰라도 되는 방법)

`bridge-server.js`가 정적 페이지(`tv-app.html`) + REST + WebSocket을 모두 포트 3000 하나로 서빙합니다.
`tv-app.html`은 자신이 로드된 호스트(LAN IP든 Cloudflare 도메인이든)로 자동으로 WebSocket을 연결하므로,
파일을 수정할 필요 없이 아래 방법 A/B 어느 쪽으로 열어도 그대로 동작합니다.

### 방법 A — 같은 Wi-Fi(LAN)일 때 (가장 간단, 추천)

TV의 인터넷 브라우저 앱에서 주소창에 입력:
```
http://192.168.0.77:3000
```
끝입니다. TV가 어떤 IP를 쓰는지 알 필요 없습니다 — TV가 Mac mini의 IP로 찾아오는 것이기 때문입니다.

### 방법 B — 사무실/외부망 TV (Cloudflare Tunnel)

TV가 Mac mini와 다른 네트워크(사무실 등)에 있을 때 사용합니다. 포트 3000 하나만 터널링하면
정적 페이지 + REST + WebSocket이 전부 같은 도메인으로 함께 노출됩니다.

```bash
cloudflared tunnel --url http://localhost:3000
# 출력된 URL 예: https://abc-xyz-education-handheld.trycloudflare.com
```

> ⚠️ **이 Mac mini에는 이미 다른 서비스(`rarebook.co.kr`)용 named tunnel이 `~/.cloudflared/config.yml`에
> 설정되어 있습니다.** 그 파일이 있으면 `--url` quick tunnel을 실행해도 cloudflared가 기존
> config.yml의 ingress 규칙(끝의 `http_status:404` catch-all)을 그대로 적용해서 **모든 요청이 404로
> 떨어지는 문제**가 있습니다 (실제로 겪었던 문제입니다). 기존 named tunnel(`rarebook`)은 절대 건드리지
> 말고, 아래처럼 **빈 config 파일을 명시적으로 지정**해서 우회하세요:
> ```bash
> echo "{}" > /tmp/cloudflared-empty.yml
> cloudflared tunnel --config /tmp/cloudflared-empty.yml --url http://localhost:3000
> ```

TV의 인터넷 브라우저에서 출력된 `https://....trycloudflare.com` 주소를 그대로 열면 됩니다.
Quick tunnel은 **재시작할 때마다 URL이 바뀌므로**, 매 데모 직전에 새로 띄우고 그때 나온 주소를 사용하세요.
(고정 URL이 필요하면 `cloudflared tunnel create <이름>` + DNS 라우팅으로 named tunnel을 따로 만들어야 합니다 — 기존 `rarebook` 설정과는 별개의 tunnel ID를 써야 합니다.)

### 방법 C — Tizen 네이티브 앱으로 설치 (설정 화면 없이 자동 연결)

`tizen-app/` 폴더에 패키징용 프로젝트가 준비되어 있습니다 (`config.xml`, `icon.png`, `index.html`).
`index.html`은 `tv-app.html`과 동일한 파일이고, **Mac mini의 고정 IP(`192.168.0.77:3000`)가
`FIXED_BRIDGE_HOST`로 하드코딩되어 있어서** TV에서 `file://`로 실행돼도(주소창 입력 없이 앱 아이콘
클릭만으로) 자동으로 연결됩니다. 별도 설정 화면이 필요 없습니다.

> ⚠️ `tv-app.html`을 다시 수정했다면, 배포 전에 반드시 다시 복사하세요:
> ```bash
> cp ~/hermes-tv-demo/tv-app.html ~/hermes-tv-demo/tizen-app/index.html
> ```

**Seller Office 인증 경로(이번에 선택한 방법)인 경우:**
1. Samsung Seller Office에서 위젯(`tizen-app/` 폴더를 `.wgt`로 패키징한 것) 인증 제출 → 승인받은 패키지를 TV에 설치
2. `internet`, `network.get` 권한은 둘 다 public 레벨이라 추가 심사 항목 없이 통과됩니다
3. 설치 후 앱 아이콘 실행 → 별도 입력 없이 바로 `192.168.0.77:3000`에 연결됨

**Tizen Studio로 직접 사이드로드해서 먼저 테스트해보고 싶다면:**
1. TV에서 개발자 모드 켜기: Apps 화면에서 `12321` 입력 → Developer mode ON → Host PC IP에 Mac mini 주소(`192.168.0.77`) 입력 → TV 재시작
2. TV가 보여주는 IP로 `sdb connect <TV IP>:26101`
3. Tizen Studio에서 `tizen-app/` 폴더를 프로젝트로 Import
4. Device Manager에서 TV 선택 → Run As → Tizen Web Application (Samsung Certificate로 서명되어 있어야 함)

---

## 3단계: 모델명 업데이트

`ollama list` 결과가 바뀌면 두 파일을 함께 수정하세요:

| 파일 | 수정 위치 | 현재값 |
|------|-----------|--------|
| `bridge-server.js` | `CONFIG.MODEL` | `"qwen2.5:7b"` |
| `tv-app.html` | (모델명은 서버가 WS로 전달하므로 수정 불필요) | — |

---

## 프리셋 질문 목록

| # | 카테고리 | 질문 |
|---|---------|------|
| 1 | 날씨 정보 | 오늘 날씨와 외출 추천 |
| 2 | 제품 안내 | 삼성 AI TV 핵심 기능 소개 |
| 3 | 엔터테인먼트 | 오늘 저녁 가족 영화 추천 |
| 4 | 요리 & 레시피 | 간단한 저녁 레시피 추천 |
| 5 | IT 트렌드 | 최신 AI 기술 트렌드 |
| 6 | 건강 & 운동 | 스트레칭 10분 루틴 |

---

## 리모컨 키 매핑

| 리모컨 버튼 | 동작 |
|-----------|------|
| ▲ / ▼ | 질문 항목 이동 |
| 확인(OK) | 선택한 질문 전송 / "직접 입력" 카드에서는 On Screen Keyboard 호출 |
| 뒤로 | 화면 초기화 (입력 중에는 입력 취소) |

### 직접 입력 (사용자 질문)

사이드바 맨 위에 항상 "✏️ 직접 입력" 카드가 고정으로 있습니다.

1. 리모컨으로 그 카드까지 이동 후 확인(OK) → `<input>`이 포커스되며 TV의 On Screen Keyboard가 자동으로 뜸
2. 키보드로 질문 입력
3. 확인(OK)/Enter → 질문 전송, 프리셋 질문과 동일하게 아이콘+답변(또는 스텝 카드) 표시
4. 뒤로(Return) → 입력 취소, 다시 카드 목록으로

입력 중에는 ▲/▼ 목록 이동이 비활성화되고 글자 입력에 집중할 수 있도록 처리되어 있습니다.

---

## 실제 추론 검증 (캔드 응답 아님을 확인)

```bash
cd ~/hermes-tv-demo
node verify-llm.js http://localhost:3000 8   # 109개 질문 풀에서 8개 무작위 추출 후 호출
```
응답마다 시간이 다르고(보통 2~10초) 질문 내용에 맞는 답이 나오면 실제 추론입니다.
`ollama ps`로 모델이 실제 메모리/GPU에 로드되어 있는지도 같이 확인할 수 있습니다.

> qwen2.5:7b는 특정 한국어 질문(예: "지구온난화")에서 temperature와 무관하게 중국어로
> 새는 경향이 있어, `bridge-server.js`에 응답을 검사해 중국어가 섞이면 자동으로
> 재시도하는 가드(`getCleanAnswer`)를 넣어뒀습니다. 드물게 중국어 외 다른 언어 토큰이
> 섞이는 경우는 아직 남아있으니, 데모 전 리허설로 한 번 더 확인하는 것을 추천합니다.

---

## 트러블슈팅

### WebSocket 연결 실패
```bash
# Ollama 외부 접속 허용 확인
echo $OLLAMA_HOST   # 0.0.0.0:11434 이어야 LAN에서 접근 가능 (bridge-server는 로컬 11434만 호출하므로 영향 없음)

# 방화벽에서 3000번 포트 허용 (macOS)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node
```

### Ollama 응답 없음
```bash
curl http://localhost:11434/api/tags
ollama run qwen2.5:7b "테스트"
```

### TV에서 wss:// 연결 안 됨
- Cloudflare Tunnel은 자동으로 HTTPS/WSS를 처리합니다.
- Tizen TV는 보안상 `ws://`(비암호화)를 차단할 수 있으므로 외부망에서는 `wss://`를 사용하세요.
