
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const STATS_PATH = path.join(ROOT, "stats.json");
const OUTPUT_PATH = path.join(ROOT, "assets", "github-stats.svg");

if (!fs.existsSync(STATS_PATH)) {
  throw new Error("stats.json was not found. Run generate-stats.js first.");
}

const stats = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));

if (
  !stats.profile ||
  !stats.repositories ||
  !stats.contributions ||
  !Array.isArray(stats.publicLanguages)
) {
  throw new Error("stats.json is missing required statistics.");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function firstNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }

  return 0;
}

const username =
  stats.profile.username ||
  stats.profile.login ||
  "VUNENE-HLUNGWANI";

const contributionCount = firstNumber(
  stats.contributions.last365Days,
  stats.contributions.totalLast365Days,
  stats.contributions.total
);

const commitCount = firstNumber(
  stats.repositoryCommits?.total,
  stats.activity?.totalCommits,
  stats.activity?.commits
);

const repositoryCount = firstNumber(
  stats.repositories.total,
  stats.repositories.totalAccessible,
  stats.repositories.count
);

const starCount = firstNumber(
  stats.repositories.starsReceivedOnAllAccessibleRepos,
  stats.repositories.totalStars,
  stats.repositories.stars
);

const metrics = [
  {
    label: "CONTRIBUTIONS",
    subtitle: "Last 365 days",
    value: contributionCount
  },
  {
    label: "COMMITS",
    subtitle: "Recorded commits",
    value: commitCount
  },
  {
    label: "REPOSITORIES",
    subtitle: "Accessible repos",
    value: repositoryCount
  },
  {
    label: "STARS",
    subtitle: "Stars received",
    value: starCount
  }
];

const metricCards = metrics.map((metric, index) => {
  const x = 28 + index * 178;
  const accent = index % 2 === 0 ? "#ff1493" : "#b66dff";

  return `
    <g>
      <rect
        x="${x}"
        y="96"
        width="166"
        height="91"
        rx="12"
        fill="#24152e"
        stroke="#493052"
      />
      <rect
        x="${x}"
        y="96"
        width="3"
        height="91"
        rx="1.5"
        fill="${accent}"
      />
      <text
        x="${x + 14}"
        y="119"
        fill="#d9c5e3"
        font-size="10"
        font-weight="700"
        letter-spacing="0.6"
      >${escapeXml(metric.label)}</text>
      <text
        x="${x + 14}"
        y="151"
        fill="#fff5fc"
        font-size="25"
        font-weight="800"
      >${escapeXml(formatNumber(metric.value))}</text>
      <text
        x="${x + 14}"
        y="172"
        fill="#bba8c5"
        font-size="10"
      >${escapeXml(metric.subtitle)}</text>
    </g>`;
}).join("");

const languages = stats.publicLanguages
  .filter(language => language && language.name)
  .sort((a, b) => Number(b.bytes || 0) - Number(a.bytes || 0))
  .slice(0, 3);

const totalLanguageBytes = languages.reduce(
  (total, language) => total + Number(language.bytes || 0),
  0
);

const languageRows = languages.length
  ? languages.map((language, index) => {
      const y = 222 + index * 25;
      const bytes = Number(language.bytes || 0);

      const percentage = totalLanguageBytes > 0
        ? (bytes / totalLanguageBytes) * 100
        : 0;

      const barWidth = Math.max(
        0,
        Math.min(percentage, 100)
      ) * 7;

      const barColor = index % 2 === 0 ? "#ff1493" : "#b66dff";

      return `
        <g>
          <text
            x="30"
            y="${y}"
            fill="#fff5fc"
            font-size="11"
            font-weight="600"
          >${escapeXml(language.name)}</text>

          <text
            x="730"
            y="${y}"
            fill="#d9c5e3"
            font-size="11"
            text-anchor="end"
          >${percentage.toFixed(1)}%</text>

          <rect
            x="30"
            y="${y + 6}"
            width="700"
            height="5"
            rx="2.5"
            fill="#3a2942"
          />

          <rect
            x="30"
            y="${y + 6}"
            width="${barWidth}"
            height="5"
            rx="2.5"
            fill="${barColor}"
          />
        </g>`;
    }).join("")
  : `
    <text x="30" y="229" fill="#bba8c5" font-size="12">
      No public language data available yet.
    </text>`;

const generatedDate = stats.generatedAt
  ? String(stats.generatedAt).slice(0, 10)
  : new Date().toISOString().slice(0, 10);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="760"
  height="320"
  viewBox="0 0 760 320"
  role="img"
  aria-labelledby="title description"
>
  <title id="title">Nene's Divaloper GitHub Statistics</title>

  <desc id="description">
    GitHub contributions, commits, repositories, stars and public programming
    languages for ${escapeXml(username)}.
  </desc>

  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#21112b"/>
      <stop offset="100%" stop-color="#120b18"/>
    </linearGradient>

    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff1493"/>
      <stop offset="100%" stop-color="#b66dff"/>
    </linearGradient>
  </defs>

  <rect
    x="1"
    y="1"
    width="758"
    height="318"
    rx="18"
    fill="url(#background)"
    stroke="#493052"
    stroke-width="1.5"
  />

  <rect x="1" y="1" width="758" height="4" rx="2" fill="url(#accent)"/>

  <circle cx="31" cy="32" r="5" fill="#ff1493"/>
  <circle cx="47" cy="32" r="5" fill="#b66dff"/>
  <circle cx="63" cy="32" r="5" fill="#82edb0"/>

  <text
    x="30"
    y="62"
    fill="#fff5fc"
    font-size="21"
    font-weight="800"
  >Nene's Divaloper</text>

  <text
    x="30"
    y="81"
    fill="#c9b5d3"
    font-size="11"
  >GitHub Statistics · ${escapeXml(username)}</text>

  <text
    x="730"
    y="43"
    fill="#ff72bd"
    font-size="10"
    font-weight="700"
    text-anchor="end"
  >MY CODING JOURNEY</text>

  ${metricCards}

  <text
    x="30"
    y="211"
    fill="#fff5fc"
    font-size="12"
    font-weight="800"
  >PUBLIC LANGUAGES</text>

  ${languageRows}

  <text
    x="730"
    y="306"
    fill="#8f7b9a"
    font-size="9"
    text-anchor="end"
  >Updated ${escapeXml(generatedDate)} · Explore the full dashboard</text>
</svg>
`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, svg, "utf8");

console.log(`Custom GitHub stats card generated: ${OUTPUT_PATH}`);
