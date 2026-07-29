// 좁은 폰에서 가로가 넘치지 않는지 계산으로 확인한다. 브라우저 없이 돈다.
//   node test_width.js
const fs = require("fs");

const html = fs.readFileSync("docs/index.html", "utf8");
const script = html.match(/<script>\r?\n([\s\S]*?)<\/script>/)[1];
const stub = `
  var document = { getElementById: function () { return { innerHTML: "", querySelectorAll: function () { return []; } }; } };
  var fetch = function () { return { then: function () { return this; }, catch: function () { return this; } }; };
  var localStorage = { getItem: function () { return null; }, setItem: function () {} };
  var window = { scrollTo: function () {} };
`;
const run = new Function(stub + script.replace(/fetch\("prices\.json[\s\S]*$/, "") + `
  return { state: state, kindsAvailable: kindsAvailable, tableHTML: tableHTML,
           heroHTML: heroHTML, shortName: shortName, flatName: flatName, series: series, change: change };
`);
const m = run();

const store = JSON.parse(fs.readFileSync("docs/prices.json", "utf8"));
const market = store.markets.seoandong;
m.state.days = market.days;
m.state.dates = Object.keys(market.days).sort();
m.state.marketName = market.name;
m.state.kind = "화건 꼭무";

// 글자 폭 어림값 (px). 한글은 글자크기와 거의 같고, 숫자·쉼표는 그보다 좁다.
function textWidth(s, size) {
  let w = 0;
  for (const ch of s) {
    if (/[가-힣]/.test(ch)) w += size * 1.0;
    else if (/[0-9]/.test(ch)) w += size * 0.6;
    else if (/[,.]/.test(ch)) w += size * 0.28;
    else if (/[▲▼―·~]/.test(ch)) w += size * 0.85;
    else if (ch === " ") w += size * 0.3;
    else w += size * 0.55;
  }
  return Math.ceil(w);
}

const PHONE = 320;   // 요즘 제일 좁은 폰 기준으로 잡는다
const BODY = PHONE - 32;  // 좌우 여백 16px씩

let fail = 0;
const check = (label, used, limit) => {
  const ok = used <= limit;
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}: ${used}px / ${limit}px`);
  if (!ok) fail++;
};

console.log(`== 화면 폭 ${PHONE}px 기준 (본문 ${BODY}px) ==\n`);

const kinds = m.kindsAvailable();

console.log("-- 머리글 (날짜 + 확인 도장 한 줄) --");
const dateW = textWidth("7월 27일 (월)", 24);
const stampW = Math.max(textWidth("확인", 13), textWidth("7/27 22:17", 14)) + 18 + 6; // 좌우 여백 9px, 테두리 3px
console.log(`  날짜 ${dateW}px · 도장 ${stampW}px · 간격 8px`);
check("한 줄에 들어감", dateW + stampW + 8, BODY);

console.log("\n-- 품종 버튼 (3칸) --");
const cell = Math.floor((BODY - 14) / 3);   // gap 7px씩
kinds.forEach((k) => {
  const lines = m.shortName(k).split("<br>");
  const w = Math.max(...lines.map((l) => textWidth(l, 15)));
  check(`${k} (${lines.length}줄)`, w + 8, cell);   // 좌우 padding 4px씩
});

console.log("\n-- 표 4칸 (품종·평균가·등락·물량) --");
const last = m.state.dates[m.state.dates.length - 1];
let maxName = 0, maxAvg = 0, maxDiff = 0, maxVol = 0;
kinds.forEach((k) => {
  const v = m.state.days[last][k];
  // kg 품종은 이름 뒤에 배지가 붙는다
  maxName = Math.max(maxName, textWidth(m.flatName(k), 15) + (v && v.unit !== "근" ? 26 : 0));
  if (v) {
    maxAvg = Math.max(maxAvg, textWidth(v.avg.toLocaleString("ko-KR"), 16));
    maxVol = Math.max(maxVol, textWidth((v.volume || 0).toLocaleString("ko-KR"), 16));
  }
  const c = m.change(k);
  if (c) maxDiff = Math.max(maxDiff, textWidth("▲" + Math.abs(c.diff).toLocaleString("ko-KR"), 16));
});
console.log(`  품종 ${maxName}px · 평균가 ${maxAvg}px · 등락 ${maxDiff}px · 물량 ${maxVol}px`);
check("표 한 줄 합계", maxName + maxAvg + maxDiff + maxVol + 8, BODY);   // 칸 여백 1px씩

console.log("\n-- 오늘 값 (큰 숫자) --");
const v = m.state.days[last][m.state.kind];
check("평균가 54px", textWidth(v.avg.toLocaleString("ko-KR"), 54) + textWidth("원", 24), BODY - 32);
check("등락 줄", textWidth("▲ 1,027원 오름", 19), BODY - 32);
check("지난 경매 줄", textWidth("지난 경매 11,107원", 15), BODY - 32);

console.log("\n-- 최고·최저 두 칸 --");
const half = Math.floor((BODY - 2) / 2);
check("최고가 칸", textWidth(v.high.toLocaleString("ko-KR"), 21) + 8, half);
check("최저가 칸", textWidth(v.low.toLocaleString("ko-KR"), 21) + 8, half);

console.log("\n-- 기간 버튼 (4칸) --");
const rcell = Math.floor((BODY - 21) / 4);
["일주일", "한 달", "석 달", "1년"].forEach((t) => check(t, textWidth(t, 16) + 6, rcell));

console.log("\n-- 기간 요약 세 칸 --");
const qcell = Math.floor(BODY / 3);
check("가장 긴 값 (15,480)", textWidth("15,480", 18) + 6, qcell);

console.log(fail === 0 ? "\n전부 들어감" : `\n넘침 ${fail}건`);
process.exit(fail ? 1 : 0);
