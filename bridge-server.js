/**
 * Hermes TV Bridge Server
 * Mac mini에서 실행 → Ollama Hermes → Tizen TV 연결
 *
 * TV의 IP는 몰라도 됩니다: TV(웹앱)가 이 서버의 주소로 먼저 접속해옵니다.
 *
 * 실행: node bridge-server.js
 * 포트: 3000 (WebSocket + REST)
 */

const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const TV_APP_HTML_PATH = path.join(__dirname, "tv-app.html");

// ── 설정 ──────────────────────────────────────────────────────────────────
const CONFIG = {
  PORT: 3000,
  OLLAMA_HOST: "http://localhost:11434",
  MODEL: "qwen2.5:7b", // `ollama list` 결과에 맞게 수정
  SYSTEM_PROMPT: `당신은 Samsung TV에 탑재된 AI 어시스턴트 Hermes입니다.
TV 사용자에게 친절하고 간결하게 답변하세요.
답변은 TV 화면에 표시되므로 핵심 내용만 3~5문장으로 요약해서 답변하세요.

언어 규칙(반드시 준수):
- 사용자가 한국어로 질문하면 답변의 모든 글자를 한국어(또는 필요한 영어 고유명사)로만 작성하세요.
- 중국어 한자, 병음, 중국어 문장은 단 한 글자도 출력하지 마세요. 예: "自然而流畅地" 같은 표현은 절대 금지입니다.
- 작성 중 다른 언어가 섞이려고 하면 즉시 멈추고 한국어로 다시 표현하세요.`,
};

// ── 시각화 헬퍼: 질문 카테고리 아이콘 + 답변 속 번호 목록을 스텝 카드로 추출 ──
const ICON_RULES = [
  { keywords: ["날씨", "기온", "외출", "비", "눈", "장마", "태풍", "더위", "추위"], icon: "🌤️" },
  { keywords: ["삼성", "AI TV", "리모컨", "TV 기능", "스마트TV"], icon: "📺" },
  { keywords: ["영화", "드라마", "넷플릭스", "다큐멘터리", "음악", "노래", "콘서트"], icon: "🎬" },
  { keywords: ["레시피", "요리", "음식", "라면", "계란", "커피", "차 ", "맛있"], icon: "🍳" },
  { keywords: ["AI", "인공지능", "머신러닝", "블록체인", "컴퓨터", "프로그래밍", "코드", "유튜브", "와이파이", "엑셀", "파워포인트", "노트북"], icon: "💻" },
  { keywords: ["운동", "스트레칭", "건강", "수면", "면역", "마라톤", "축구", "다이어트"], icon: "🏃" },
  { keywords: ["여행", "제주", "유럽", "도시"], icon: "✈️" },
  { keywords: ["주식", "채권", "복리", "비상금", "경제", "금융", "비트코인"], icon: "💰" },
  { keywords: ["역사", "조선", "산업혁명", "한글날", "세종대왕"], icon: "📜" },
  { keywords: ["스트레스", "번아웃", "심리", "긍정", "기억력", "집중력"], icon: "🧠" },
  { keywords: ["아이", "부모", "육아", "가족"], icon: "👨‍👩‍👧" },
  { keywords: ["면접", "이력서", "퇴사", "재택근무", "팀워크", "리더십", "협상", "발표", "이메일"], icon: "💼" },
  { keywords: ["강아지", "고양이", "반려동물"], icon: "🐶" },
  { keywords: ["환경", "지구온난화", "온난화", "재활용"], icon: "🌱" },
  { keywords: ["피부", "스킨케어", "패션", "옷", "코디"], icon: "💅" },
  { keywords: ["번역", "영어로", "일본어로", "중국어로"], icon: "🌐" },
  { keywords: ["곱하기", "더하면", "수학", "계산"], icon: "🔢" },
  { keywords: ["유머", "아재개그", "농담"], icon: "😄" },
  { keywords: ["지진", "화산", "오로라", "무지개", "달", "별", "바다", "하늘"], icon: "🔭" },
];

function pickIcon(question) {
  for (const rule of ICON_RULES) {
    if (rule.keywords.some((kw) => question.includes(kw))) return rule.icon;
  }
  return "🤖";
}

// "1. ..." / "1) ..." 형태로 시작하는 줄이 2개 이상이면 스텝 목록으로 간주한다.
function parseSteps(answer) {
  const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);
  const steps = [];
  for (const line of lines) {
    const m = line.match(/^(\d+)[.)]\s*(.+)/);
    if (m) steps.push(m[2]);
  }
  return steps.length >= 2 ? steps : null;
}

function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

// ── HTTP + WebSocket 서버 ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${CONFIG.PORT}`);

  // ── TV 웹앱 정적 페이지 (LAN/Cloudflare Tunnel 어느 호스트로 열어도 동작) ──
  if ((url.pathname === "/" || url.pathname === "/tv-app.html") && req.method === "GET") {
    fs.readFile(TV_APP_HTML_PATH, "utf8", (err, html) => {
      if (err) {
        res.writeHead(500);
        res.end("tv-app.html을 읽을 수 없습니다");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    return;
  }

  // ── Health check ──
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: CONFIG.MODEL, ts: Date.now() }));
    return;
  }

  // ── 모델 목록 ──
  if (url.pathname === "/models" && req.method === "GET") {
    fetchOllama("/api/tags", "GET", null).then((data) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    }).catch((e) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // ── REST: 단일 질문/응답 (스트리밍 없음) ──
  if (url.pathname === "/ask" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { question, model } = JSON.parse(body);
        const answer = await getCleanAnswer(question, model || CONFIG.MODEL);
        const icon = pickIcon(question);
        const steps = parseSteps(answer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ answer, icon, steps, model: model || CONFIG.MODEL }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

// ── WebSocket: 스트리밍 응답 ─────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const clientIP = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`[WS] TV 연결됨: ${clientIP}`);

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", text: "Invalid JSON" }));
      return;
    }

    if (msg.type === "ask") {
      const { question, model, requestId } = msg;
      console.log(`[ASK] ${question}`);

      ws.send(JSON.stringify({ type: "start", requestId }));

      try {
        const answer = await getCleanAnswer(question, model || CONFIG.MODEL);
        const icon = pickIcon(question);
        const steps = parseSteps(answer);

        ws.send(JSON.stringify({ type: "icon", icon, requestId }));

        // 언어 검증을 마친 완성된 답변을 타이핑 효과로 흘려보낸다 (UX는 그대로 유지).
        for (const chunk of answer.match(/.{1,3}/gs) || []) {
          if (ws.readyState !== WebSocket.OPEN) break;
          ws.send(JSON.stringify({ type: "token", text: chunk, requestId }));
          await sleep(18);
        }
        ws.send(JSON.stringify({ type: "done", requestId, icon, steps }));
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", text: e.message, requestId }));
      }
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", () => console.log(`[WS] TV 연결 종료: ${clientIP}`));
  ws.on("error", (e) => console.error(`[WS] 오류:`, e.message));

  ws.send(JSON.stringify({ type: "connected", model: CONFIG.MODEL }));
});

// ── Ollama 연동 함수 ─────────────────────────────────────────────────────
async function fetchOllama(path, method = "POST", body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.OLLAMA_HOST + path);
    const options = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// qwen2.5는 특정 한국어 주제(예: 지구온난화)에서 temperature와 무관하게
// 중국어로 새는 경우가 있다 — 출력에 한자가 섞였는지 검사한다.
function hasChineseContamination(text) {
  const hanCount = (text.match(/[一-鿿]/g) || []).length;
  return hanCount > 0;
}

async function chatOnce(question, model, temperature) {
  const data = await fetchOllama("/api/chat", "POST", {
    model,
    stream: false,
    options: { temperature, repeat_penalty: 1.15 },
    messages: [
      { role: "system", content: CONFIG.SYSTEM_PROMPT },
      { role: "user", content: question },
    ],
  });
  return data?.message?.content || "";
}

// 중국어 오염이 감지되면 temperature를 바꿔 최대 2회 재시도하고,
// 그래도 안 되면 마지막으로 "한국어로만 다시 써줘" 교정 호출을 한 번 더 시도한다.
async function getCleanAnswer(question, model) {
  const temperatures = [0.15, 0.5, 0.8];
  let lastAnswer = "";

  for (const temperature of temperatures) {
    const answer = await chatOnce(question, model, temperature);
    lastAnswer = answer;
    if (answer && !hasChineseContamination(answer)) return answer;
    console.warn(`[LANG-GUARD] 중국어 오염 감지 (temperature=${temperature}), 재시도`);
  }

  const fixed = await chatOnce(
    `다음 텍스트에 섞여 있는 중국어를 모두 한국어로 바꿔서, 한국어로만 다시 써줘:\n\n${lastAnswer}`,
    model,
    0.2
  );
  if (fixed && !hasChineseContamination(fixed)) return fixed;

  console.warn("[LANG-GUARD] 교정 실패, 마지막 응답을 그대로 반환");
  return lastAnswer || "답변을 생성하지 못했습니다.";
}

// ── 시작 ──────────────────────────────────────────────────────────────────
server.listen(CONFIG.PORT, "0.0.0.0", () => {
  const lanIP = getLanIP();
  console.log(`\n🦌 Hermes TV Bridge Server 시작`);
  console.log(`   Local : http://localhost:${CONFIG.PORT}`);
  console.log(`   LAN   : http://${lanIP}:${CONFIG.PORT}`);
  console.log(`   모델  : ${CONFIG.MODEL}`);
  console.log(`   헬스체크: http://localhost:${CONFIG.PORT}/health\n`);
});
