const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const STATS_PATH = path.join(ROOT, "stats.json");
const OUTPUT_PATH = path.join(ROOT, "assets", "github-stats.svg");

const WIDTH = 1000;
const HEIGHT = 480;

const C = {
  background: "#21112b",
  backgroundDark: "#120b18",
  panel: "#24152e",
  border: "#493052",
  pink: "#ff1493",
  pinkLight: "#ff72bd",
  purple: "#b66dff",
  green: "#82edb0",
  yellow: "#f5df70",
  blue: "#58b8d8",
  orange: "#ff9859",
  text: "#fff5fc",
  muted: "#c9b5d3",
  subtle: "#8f7b9a",
  grid: "#493052"
};

if (!fs.existsSync(STATS_PATH)) {
  throw new Error("stats.json was not found. Run generate-stats.js first.");
}

const stats = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));

if (!stats.profile || !stats.repositories || !stats.contributions) {
  throw new Error("stats.json is missing required statistics.");
}

const profile = stats.profile;
const repositories = stats.repositories;
const contributions = stats.contributions;
const commits = stats.repositoryCommits || {};
const activity = stats.activity || {};

function n(value) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function fmt(value) {
  return n(value).toLocaleString("en-US");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function text(x, y, value, size = 13, color = C.text,
              weight = 400, anchor = "start") {
  return `<text x="${x}" y="${y}"
    fill="${color}"
    font-family="Segoe UI, Arial, sans-serif"
    font-size="${size}"
    font-weight="${weight}"
    text-anchor="${anchor}">${esc(value)}</text>`;
}

function line(x1, y1, x2, y2, color, width = 1, opacity = 1) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
    stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
}

const displayName = profile.name || profile.username || "Divaloper";
const username = profile.username || "VUNENE-HLUNGWANI";

const generatedDate = stats.generatedAt
  ? String(stats.generatedAt).slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// Real metrics supplied by the existing statistics collector.
const metrics = [
  {
    icon: "☆",
    label: "Stars Earned",
    value: repositories.starsReceivedOnAllAccessibleRepos ??
      repositories.starsReceivedOnPublicRepos ?? 0,
    color: C.orange
  },
  {
    icon: "▣",
    label: "Repositories",
    value: repositories.total,
    color: C.purple
  },
  {
    icon: "⑂",
    label: "Commits",
    value: commits.total ?? 0,
    color: C.pink
  },
  {
    icon: "↗",
    label: "Pull Requests",
    value: activity.pullRequestsAuthored ?? 0,
    color: C.pinkLight
  },
  {
    icon: "◎",
    label: "Issues",
    value: activity.issuesAuthored ?? 0,
    color: C.yellow
  },
  {
    icon: "▤",
    label: "Code Reviews",
    value: contributions.pullRequestReviewsAllYears ?? 0,
    color: C.blue
  },
  {
    icon: "●",
    label: "Contributions",
    value: contributions.allTime ?? 0,
    color: C.green
  }
];

const metricRows = metrics.map((item, index) => {
  const y = 82 + index * 39;

  return `
    ${text(35, y, item.icon, 22, item.color, 700)}
    ${text(70, y, item.label, 15, C.text, 500)}
    ${text(490, y, fmt(item.value), 16, C.text, 700, "end")}
  `;
}).join("");

// Yearly activity comes from the actual contribution breakdown.
const yearly = Array.isArray(contributions.yearly)
  ? contributions.yearly
      .filter(item => Number.isFinite(Number(item.year)))
      .sort((a, b) => Number(a.year) - Number(b.year))
  : [];

const series = [
  { key: "issues", label: "Issues", color: C.green },
  { key: "pullRequests", label: "Pull requests", color: C.pink },
  { key: "pullRequestReviews", label: "Reviews", color: C.orange },
  { key: "commits", label: "Commit contributions", color: C.yellow }
];

const chart = {
  left: 555,
  right: 965,
  top: 125,
  bottom: 347
};

const plotWidth = chart.right - chart.left;
const plotHeight = chart.bottom - chart.top;

const chartValues = yearly.flatMap(year =>
  series.map(item => n(year[item.key]))
);

const maxValue = Math.max(1, ...chartValues);
const tickStep = Math.max(1, Math.ceil(maxValue / 4));

let graphMarkup = "";

for (let tick = 0; tick <= maxValue; tick += tickStep) {
  const y = chart.bottom - (tick / maxValue) * plotHeight;

  graphMarkup += line(
    chart.left, y, chart.right, y, C.grid, 1, 0.75
  );

  graphMarkup += text(
    chart.left - 10, y + 4, fmt(tick), 10, C.subtle, 400, "end"
  );
}

function pointX(index) {
  if (yearly.length <= 1) return chart.left + plotWidth / 2;

  return chart.left + (index / (yearly.length - 1)) * plotWidth;
}

function pointY(value) {
  return chart.bottom - (n(value) / maxValue) * plotHeight;
}

for (const item of series) {
  const points = yearly.map((year, index) =>
    `${pointX(index)},${pointY(year[item.key])}`
  );

  if (points.length > 1) {
    graphMarkup += `
      <polyline
        points="${points.join(" ")}"
        fill="none"
        stroke="${item.color}"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />`;
  }

  yearly.forEach((year, index) => {
    graphMarkup += `
      <circle
        cx="${pointX(index)}"
        cy="${pointY(year[item.key])}"
        r="3"
        fill="${item.color}"
      >
        <title>${esc(year.year)} ${esc(item.label)}: ${fmt(year[item.key])}</title>
      </circle>`;
  });
}

yearly.forEach((year, index) => {
  graphMarkup += text(
    pointX(index),
    chart.bottom + 19,
    String(year.year),
    11,
    C.subtle,
    400,
    "middle"
  );
});

const legendPositions = [
  { x: 555, y: 91 },
  { x: 690, y: 91 },
  { x: 825, y: 91 },
  { x: 555, y: 108 }
];

const legendMarkup = series.map((item, index) => {
  const pos = legendPositions[index];

  return `
    <circle cx="${pos.x}" cy="${pos.y - 4}" r="4" fill="${item.color}"/>
    ${text(pos.x + 10, pos.y, item.label, 10, C.muted)}
  `;
}).join("");

if (yearly.length === 0) {
  graphMarkup += text(
    (chart.left + chart.right) / 2,
    225,
    "Yearly activity data is not available yet.",
    12,
    C.muted,
    400,
    "middle"
  );
}

// Language distribution uses actual public repository language byte counts.
const languages = Array.isArray(stats.publicLanguages)
  ? [...stats.publicLanguages]
      .filter(item => item && item.name)
      .sort((a, b) => n(b.bytes) - n(a.bytes))
  : [];

const languageTotal = languages.reduce(
  (total, item) => total + n(item.bytes), 0
);

const languageColors = [
  C.pink,
  C.purple,
  C.blue,
  C.orange,
  C.green,
  C.yellow
];

let languageBar = "";
let languageLegend = "";
let offset = 0;

if (languageTotal > 0) {
  languages.forEach((item, index) => {
    const percentage = n(item.bytes) / languageTotal * 100;
    const width = 936 * percentage / 100;
    const color = languageColors[index % languageColors.length];

    languageBar += `
      <rect
        x="${32 + offset}"
        y="383"
        width="${width}"
        height="8"
        fill="${color}"
      >
        <title>${esc(item.name)}: ${percentage.toFixed(1)}%</title>
      </rect>`;

    offset += width;

    const columns = 4;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 42 + column * 240;
    const y = 419 + row * 23;

    languageLegend += `
      <circle cx="${x}" cy="${y - 4}" r="5" fill="${color}"/>
      ${text(x + 14, y, item.name, 13, C.text)}
      ${text(
        x + 210, y, `${percentage.toFixed(1)}%`,
        12, C.muted, 400, "end"
      )}
    `;
  });
} else {
  languageLegend = text(
    35, 419, "No public language data available.", 12, C.muted
  );
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${WIDTH}" height="${HEIGHT}"
     viewBox="0 0 ${WIDTH} ${HEIGHT}"
     role="img" aria-labelledby="title description">

  <title id="title">Nene's GitHub Dashboard</title>
  <desc id="description">
    Automatically generated GitHub statistics for ${esc(displayName)},
    including repositories, stars, commits, issues, pull requests,
    code reviews, yearly activity and public programming languages.
  </desc>

  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.background}"/>
      <stop offset="100%" stop-color="${C.backgroundDark}"/>
    </linearGradient>

    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.pink}"/>
      <stop offset="100%" stop-color="${C.purple}"/>
    </linearGradient>
  </defs>

  <rect x="1" y="1" width="998" height="478" rx="18"
        fill="url(#background)" stroke="${C.border}" stroke-width="1.5"/>
  <rect x="1" y="1" width="998" height="4" rx="2" fill="url(#accent)"/>

  ${text(32, 38, "Nene's GitHub Dashboard", 20, C.text, 800)}
  ${text(32, 58, `@${username} · MY CODING JOURNEY`, 11, C.muted)}

  ${metricRows}

  ${line(520, 68, 520, 355, C.border, 1)}

  ${text(555, 66, "DEVELOPMENT ACTIVITY", 13, C.text, 800)}
  ${legendMarkup}
  ${graphMarkup}

  ${text(32, 367, "PUBLIC LANGUAGE DISTRIBUTION", 12, C.text, 800)}
  ${languageBar}
  ${languageLegend}

  ${text(32, 463, `Updated ${generatedDate}`, 10, C.subtle)}
  ${text(968, 463, "Nene's Divaloper", 10, C.pinkLight, 700, "end")}
</svg>
`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, svg, "utf8");

console.log(`Divaloper dashboard generated: ${OUTPUT_PATH}`);
console.log(`Statistics timestamp: ${stats.generatedAt}`);
console.log(`Metrics displayed: ${metrics.length}`);
console.log(`Activity years displayed: ${yearly.length}`);
console.log(`Public languages displayed: ${languages.length}`);
