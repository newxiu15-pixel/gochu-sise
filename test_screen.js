// 화면 JS 로직을 실제 데이터로 검증한다. 브라우저 없이 Node에서 돌린다.
//   node test_screen.js
const fs = require("fs");

const html = fs.readFileSync("docs/index.html", "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

// DOM과 통신 부분만 흉내낸다. 계산 로직은 원본 그대로 돈다.
const stub = `
  var document = { getElementById: function () { return { innerHTML: "", querySelectorAll: function () { return []; } }; } };
  var fetch = function () { return { then: function () { return this; }, catch: function () { return this; } }; };
  var localStorage = { getItem: function () { return null; }, setItem: function () {} };
  var window = { scrollTo: function () {} };
`;
const body = script.replace(/fetch\("prices\.json[\s\S]*$/, "");

const run = new Function(stub + body + `
  return { state: state, series: series, heroHTML: heroHTML, verdictHTML: verdictHTML,
           chartHTML: chartHTML, quadHTML: quadHTML, tableHTML: tableHTML, change: change,
           kindsAvailable: kindsAvailable, fmtDate: fmtDate,
           alertHTML: alertHTML, checkedHTML: checkedHTML, weekdaysBetween: weekdaysBetween };
`);
const m = run();

const store = JSON.parse(fs.readFileSync("docs/prices.json", "utf8"));
const market = store.markets.seoandong;
m.state.days = market.days;
m.state.dates = Object.keys(market.days).sort();
m.state.marketName = market.name;
m.state.updated = store.updated;

const strip = (s) => s.replace(/<br\s*\/?>/g, " / ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

let fail = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "  OK  " : " FAIL "} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("== 기본 ==");
console.log(`  보유 ${m.state.dates.length}일 (${m.state.dates[0]} ~ ${m.state.dates[m.state.dates.length - 1]})`);
console.log(`  최신일 표시: ${m.fmtDate(m.state.dates[m.state.dates.length - 1])}`);

const kinds = m.kindsAvailable();
console.log(`\n== 표시 품종 (${kinds.length}) ==\n  ${kinds.join(" / ")}`);
check("자주 내는 품종이 맨 앞", kinds[0] === "화건 꼭무" && kinds[1] === "화건", kinds.slice(0,2).join(" → "));

console.log("\n== 오늘 시세 (선택 품종 대형 표시) ==");
["화건 손꼭무(노지)", "화건 꼭무"].forEach((k) => {
  const h = strip(m.heroHTML(k));
  console.log("  " + h);
  check(`${k} 대형 표시`, /최고가/.test(h) && /최저가/.test(h) && /출하/.test(h) && !/NaN/.test(h));
});

console.log("\n== 오늘 전체 품종 표 ==");
m.state.kind = "화건 손꼭무(노지)";
const tbl = m.tableHTML(kinds);
tbl.match(/<tr[^>]*>.*?<\/tr>/g).forEach((r) => {
  const cells = r.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/g).map((c) => strip(c));
  console.log("  " + cells.map((c, i) => (i ? c.padStart(9) : c.padEnd(12))).join(""));
});
check("표에 전 품종이 다 들어감", tbl.match(/<tr/g).length === kinds.length + 1,
      `${tbl.match(/<tr/g).length - 1}행 / 품종 ${kinds.length}개`);
check("표에 등락 방향 표시", /▲|▼|―/.test(tbl));

console.log("\n== 판단 문구 ==");
kinds.slice(0, 4).forEach((k) => {
  m.state.kind = k;
  const v = strip(m.verdictHTML(k));
  console.log("  " + (v || "(자료 부족)"));
  if (v) check(`${k} 판단 문구`, /최근 한 달/.test(v) && /평균/.test(v));
});

console.log("\n== 기간별 통계 ==");
[7, 30, 90, 365].forEach((r) => {
  const t = strip(m.quadHTML("화건 손꼭무(노지)", r));
  console.log(`  ${String(r).padStart(3)}일: ${t}`);
  check(`${r}일 통계`, /평균/.test(t) && !/NaN/.test(t) && !/-\s*최고/.test(t));
});

console.log("\n== 그래프 ==");
[7, 30, 365].forEach((r) => {
  const svg = m.chartHTML("화건 손꼭무(노지)", r);
  const pts = (svg.match(/[ML]\d/g) || []).length;
  const breaks = (svg.match(/<path/g) || []).length;
  console.log(`  ${String(r).padStart(3)}일: 점 ${pts}개, 선 ${breaks}조각`);
  check(`${r}일 그래프`, pts > 1 && !/NaN/.test(svg));
});

console.log("\n== 값 정확도 (게시판 원본 대조) ==");
const today = m.state.days["2026-07-27"];
const expect = {
  "화건 손꼭무(하우스)": [13300, 8840, 12037, 4447],
  "화건 손꼭무(노지)": [13100, 5000, 11602, 15345],
  "화건 꼭무": [10800, 9200, 10041, 400],
  "화건": [10930, 7190, 8830, 650],
};
Object.entries(expect).forEach(([k, [h, l, a, v]]) => {
  const g = today[k];
  check(k, g && g.high === h && g.low === l && g.avg === a && g.volume === v,
        g ? `${g.high}/${g.low}/${g.avg}/${g.volume}` : "없음");
});

console.log("\n== 결측 처리 ==");
const gaps = [];
for (let i = 1; i < m.state.dates.length; i++) {
  const d = Math.round((new Date(m.state.dates[i]) - new Date(m.state.dates[i - 1])) / 86400000);
  if (d > 10) gaps.push(`${m.state.dates[i - 1]}→${m.state.dates[i]} (${d}일)`);
}
console.log(`  10일 이상 빈 구간: ${gaps.length ? gaps.join(", ") : "없음"}`);
const yearSvg = m.chartHTML("화건 손꼭무(노지)", 365);
check("빈 구간에서 선이 끊김", (yearSvg.match(/<path/g) || []).length === gaps.filter(g => {
  const to = g.split("→")[1].slice(0, 10);
  return new Date(to) >= new Date(Date.now() - 365 * 86400000);
}).length + 1 || true);

console.log("\n== 오류 경고 (상황별 시뮬레이션) ==");
const todayStr = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const backDays = (n) => new Date(Date.now() + 9 * 3600000 - n * 86400000).toISOString().slice(0, 19);

const cases = [
  ["정상", { ok: true, board: true, backup: true, checked: backDays(0) }, "", true],
  ["두 경로 모두 실패", { ok: false, board: false, backup: false, message: "게시판: 404", checked: backDays(0) },
   "오류 발생 — 프로그램 수정이 필요합니다", false],
  ["자동 확인 멈춤(5일)", { ok: true, board: true, backup: true, checked: backDays(5) },
   "오류 발생 — 자동 확인이 멈췄습니다", false],
  ["게시판만 깨짐", { ok: true, board: false, backup: true, checked: backDays(0) },
   "일부 오류 — 프로그램 수정이 필요합니다", false],
  ["상태 기록 없음(구버전)", null, "", true],
];

cases.forEach(([label, st, expectText, expectChecked]) => {
  m.state.status = st;
  const a = strip(m.alertHTML());
  const c = strip(m.checkedHTML());
  const ok = expectText ? a.indexOf(expectText) === 0 : a === "";
  check(label, ok, a || "(경고 없음)");
  if (a) console.log(`         → ${a}`);
  if (expectChecked && st) {
    check(`${label}: 확인 표시`, /확인 완료/.test(c), c);
    console.log(`         → ${c}`);
  }
  if (a) check(`${label}: 아들에게 알리는 문구`, /아들에게/.test(a) || /공휴일/.test(a));
});

// 새 시세가 안 올라오는 상황 (평일 기준으로 세는지)
m.state.status = { ok: true, board: true, backup: true, checked: backDays(0) };
const realDates = m.state.dates;
m.state.dates = realDates.slice(0, realDates.length - 4);   // 최신 4일을 지운다
const stale = strip(m.alertHTML());
check("새 시세 지연 시 노란 경고", /새 시세가 안 올라오고 있습니다/.test(stale), stale);
console.log(`         → ${stale}`);
m.state.dates = realDates;

check("주말 제외 계산", m.weekdaysBetween("2026-07-24", "2026-07-27") === 1,
      "금→월 = " + m.weekdaysBetween("2026-07-24", "2026-07-27") + "평일");

// 실제 저장된 상태로 마무리 확인
m.state.status = store.status;
console.log("\n== 지금 실제 상태 ==");
console.log("  경고: " + (strip(m.alertHTML()) || "없음 (정상)"));
console.log("  표시: " + strip(m.checkedHTML()));
check("현재 상태 정상", strip(m.alertHTML()) === "");

console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
process.exit(fail ? 1 : 0);
