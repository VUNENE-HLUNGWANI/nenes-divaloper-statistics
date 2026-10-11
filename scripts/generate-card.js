const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const STATS_PATH = path.join(ROOT, "stats.json");
const OUTPUT_PATH = path.join(ROOT, "assets", "github-stats.svg");

const WIDTH = 960;
const HEIGHT = 1160;

const C = {
  background: "#160d1d",
  backgroundLight: "#21112b",
  panel: "#24152e",
  panelLight: "#2d1b38",
  border: "#493052",
  pink: "#ff1493",
  pinkLight: "#ff72bd",
  purple: "#b66dff",
  text: "#fff5fc",
  muted: "#c9b5d3",
  subtle: "#8f7b9a",
  track: "#3a2942",
  green: "#82edb0"
};

if (!fs.existsSync(STATS_PATH)) {
  throw new Error("stats.json was not found. Generate statistics first.");
}

const stats = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));

if (
  !stats.profile ||
  !stats.repositories ||
  !stats.contributions ||
  !stats.repositoryCommits ||
  !stats.activity
) {
  throw new Error("stats.json is missing required statistics sections.");
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function number(value) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function fmt(value) {
  return number(value).toLocaleString("en-US");
}

function rect(x, y, width, height, fill = C.panel, radius = 14) {
  return `
    <rect
      x="${x}" y="${y}"
      width="${width}" height="${height}"
      rx="${radius}"
      fill="${fill}"
      stroke="${C.border}"
      stroke-width="1"
    />`;
}

function text(
  x,
  y,
  value,
  size = 12,
  color = C.text,
  weight = 400,
  anchor = "start"
) {
  return `
    <text
      x="${x}" y="${y}"
      fill="${color}"
      font-family="Segoe UI, Arial, sans-serif"
      font-size="${size}"
      font-weight="${weight}"
      text-anchor="${anchor}"
    >${esc(value)}</text>`;
}

function sectionTitle(x, y, title, subtitle = "") {
  return `
    ${text(x, y, title, 14, C.text, 800)}
    ${subtitle ? text(x, y + 17, subtitle, 10, C.subtle) : ""}
  `;
}

function bar(x, y, width, height, percentage, color) {
  const fillWidth = Math.max(
    0,
    Math.min(width, width * number(percentage) / 100)
  );

  return `
    <rect
      x="${x}" y="${y}"
      width="${width}" height="${height}"
      rx="${height / 2}"
      fill="${C.track}"
    />
    <rect
      x="${x}" y="${y}"
      width="${fillWidth}" height="${height}"
      rx="${height / 2}"
      fill="${color}"
    />`;
}

const profile = stats.profile;
const contributions = stats.contributions;
const repositories = stats.repositories;
const repoCommits = stats.repositoryCommits;
const activity = stats.activity;

const displayName = profile.name || profile.username || "Divaloper";
const username = profile.username || "VUNENE-HLUNGWANI";

const publicLanguages = Array.isArray(stats.publicLanguages)
  ? stats.publicLanguages
  : [];

const accessibleLanguages = Array.isArray(stats.allAccessibleLanguages)
  ? stats.allAccessibleLanguages
  : [];

const yearlyContributions = Array.isArray(contributions.yearly)
  ? contributions.yearly
  : [];

const yearlyCommits = Array.isArray(repoCommits.yearly)
  ? repoCommits.yearly
  : [];

const dailyCalendar = Array.isArray(contributions.last365DaysCalendar)
  ? contributions.last365DaysCalendar
  : [];

const repositoryCommitDetails = Array.isArray(repoCommits.repositories)
  ? repoCommits.repositories
  : [];

const publicRepositoryDetails = Array.isArray(repositories.publicDetails)
  ? repositories.publicDetails
  : [];

const generatedDate = stats.generatedAt
  ? String(stats.generatedAt).slice(0, 10)
  : new Date().toISOString().slice(0, 10);

// --------------------------------------------------
// 1. OVERVIEW METRICS
// --------------------------------------------------

const metrics = [
  {
    label: "CONTRIBUTIONS",
    value: contributions.last365Days,
    subtitle: "Last 365 days",
    color: C.pink
  },
  {
    label: "ALL-TIME",
    value: contributions.allTime,
    subtitle: "Total contributions",
    color: C.purple
  },
  {
    label: "COMMITS",
    value: repoCommits.total,
    subtitle: "Tracked repositories",
    color: C.pink
  },
  {
    label: "REPOSITORIES",
    value: repositories.total,
    subtitle: `${fmt(repositories.public)} public`,
    color: C.purple
  },
  {
    label: "STARS",
    value: repositories.starsReceivedOnAllAccessibleRepos,
    subtitle: `${fmt(repositories.forksOfAllAccessibleRepos)} forks`,
    color: C.pink
  }
];

const metricCards = metrics.map((metric, index) => {
  const x = 24 + index * 183;
  const width = 174;

  return `
    <g>
      ${rect(x, 100, width, 88)}
      <rect
        x="${x}" y="100"
        width="3" height="88"
        rx="1.5"
        fill="${metric.color}"
      />
      ${text(x + 13, 122, metric.label, 9, C.muted, 700)}
      ${text(x + 13, 153, fmt(metric.value), 25, C.text, 800)}
      ${text(x + 13, 174, metric.subtitle, 9, C.subtle)}
    </g>`;
}).join("");

// --------------------------------------------------
// 2. LAST-365-DAYS CONTRIBUTION HEATMAP
// --------------------------------------------------

const graphX = 210;
const graphY = 278;
const cellSize = 9;
const cellStep = 13;

const graphColors = {
  NONE: "#302039",
  FIRST_QUARTILE: "#75265b",
  SECOND_QUARTILE: "#bd267e",
  THIRD_QUARTILE: "#ec48a2",
  FOURTH_QUARTILE: "#ff8ac9"
};

function contributionColor(day) {
  if (day.level && graphColors[day.level]) {
    return graphColors[day.level];
  }

  const count = number(day.count);

  if (count === 0) return graphColors.NONE;
  if (count <= 2) return graphColors.FIRST_QUARTILE;
  if (count <= 5) return graphColors.SECOND_QUARTILE;
  if (count <= 10) return graphColors.THIRD_QUARTILE;

  return graphColors.FOURTH_QUARTILE;
}

let calendarCells = "";
let monthLabels = "";

const firstCalendarDate = dailyCalendar.length
  ? new Date(`${dailyCalendar[0].date}T00:00:00Z`)
  : null;

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const seenMonths = new Set();

for (const day of dailyCalendar) {
  if (!day.date || !firstCalendarDate) continue;

  const date = new Date(`${day.date}T00:00:00Z`);

  if (Number.isNaN(date.getTime())) continue;

  const dayOffset = Math.round(
    (date.getTime() - firstCalendarDate.getTime()) / 86400000
  );

  const weekday = Number.isInteger(day.weekday)
    ? day.weekday
    : date.getUTCDay();

  const firstWeekday = firstCalendarDate.getUTCDay();
  const week = Math.floor((dayOffset + firstWeekday) / 7);

  const x = graphX + week * cellStep;
  const y = graphY + weekday * cellStep;

  calendarCells += `
    <rect
      x="${x}" y="${y}"
      width="${cellSize}" height="${cellSize}"
      rx="2"
      fill="${contributionColor(day)}"
    >
      <title>${esc(day.date)}: ${fmt(day.count)} contributions</title>
    </rect>`;

  if (day.date.slice(8, 10) === "01") {
    const monthKey = day.date.slice(0, 7);

    if (!seenMonths.has(monthKey)) {
      seenMonths.add(monthKey);

      monthLabels += text(
        x,
        graphY - 10,
        monthNames[date.getUTCMonth()],
        9,
        C.muted
      );
    }
  }
}

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  .map((day, index) =>
    text(194, graphY + index * cellStep + 8, day, 8, C.subtle, 400, "end")
  )
  .join("");

const calendarTotal = dailyCalendar.reduce(
  (total, day) => total + number(day.count),
  0
);

const calendarContent = dailyCalendar.length
  ? `
      ${weekdayLabels}
      ${monthLabels}
      ${calendarCells}
      ${text(
        210,
        390,
        `${fmt(calendarTotal)} daily contributions represented`,
        9,
        C.muted
      )}
    `
  : text(40, 290, "No daily contribution calendar available.", 11, C.muted);

// --------------------------------------------------
// 3. YEARLY CONTRIBUTION AND COMMIT BREAKDOWN
// --------------------------------------------------

const years = [...new Set([
  ...yearlyContributions.map(item => item.year),
  ...yearlyCommits.map(item => item.year)
])].sort((a, b) => Number(a) - Number(b));

const yearCards = years.length
  ? years.slice(-3).map((year, index) => {
      const contribution = yearlyContributions.find(
        item => Number(item.year) === Number(year)
      ) || {};

      const commit = yearlyCommits.find(
        item => Number(item.year) === Number(year)
      ) || {};

      const x = 40 + index * 294;

      return `
        <g>
          ${rect(x, 510, 276, 76, C.panelLight, 10)}
          ${text(x + 14, 533, String(year), 14, C.pinkLight, 800)}
          ${text(x + 14, 554, `${fmt(contribution.total)} contributions`, 11, C.text, 600)}
          ${text(x + 14, 572, `${fmt(commit.count)} commits`, 10, C.muted)}
          ${text(
            x + 260,
            533,
            `${fmt(contribution.pullRequests)} PRs`,
            9,
            C.muted,
            400,
            "end"
          )}
        </g>`;
    }).join("")
  : text(40, 530, "No yearly breakdown available.", 11, C.muted);

// --------------------------------------------------
// 4. LANGUAGE BREAKDOWNS
// --------------------------------------------------

function makeLanguageList(items, x, y, width, limit = 5) {
  const list = [...items]
    .filter(item => item && item.name)
    .sort((a, b) => number(b.bytes) - number(a.bytes))
    .slice(0, limit);

  const totalBytes = list.reduce(
    (total, language) => total + number(language.bytes),
    0
  );

  if (!list.length) {
    return text(x, y + 25, "No language data available.", 10, C.muted);
  }

  return list.map((language, index) => {
    const rowY = y + index * 25;
    const percentage = totalBytes
      ? number(language.bytes) / totalBytes * 100
      : 0;

    const color = index % 2 === 0 ? C.pink : C.purple;

    return `
      <g>
        ${text(x, rowY, language.name, 10, C.text, 600)}
        ${text(x + width, rowY, `${percentage.toFixed(1)}%`, 9, C.muted, 400, "end")}
        ${bar(x, rowY + 6, width, 4, percentage, color)}
      </g>`;
  }).join("");
}

// --------------------------------------------------
// 5. PUBLIC REPOSITORY BREAKDOWN
// --------------------------------------------------

const publicRepos = publicRepositoryDetails
  .slice()
  .sort((a, b) => number(b.commits) - number(a.commits))
  .slice(0, 4);

const repositoryRows = publicRepos.length
  ? publicRepos.map((repo, index) => {
      const y = 875 + index * 27;

      const commitInfo = repositoryCommitDetails.find(
        item => item.name === repo.name
      ) || {};

      return `
        <g>
          ${text(42, y, repo.name, 10, C.text, 600)}
          ${text(520, y, `${fmt(commitInfo.total ?? repo.commits)} commits`, 10, C.muted)}
          ${text(670, y, `★ ${fmt(repo.stars)}`, 10, C.pinkLight)}
          ${text(790, y, `⑂ ${fmt(repo.forks)}`, 10, C.muted)}
          ${text(915, y, repo.language || "Other", 10, C.muted, 400, "end")}
        </g>`;
    }).join("")
  : text(42, 875, "No public repository details available.", 10, C.muted);

// --------------------------------------------------
// 6. ISSUES AND PULL REQUEST ACTIVITY
// --------------------------------------------------

const activityMetrics = [
  ["Issues opened", activity.issuesAuthored],
  ["Open issues", activity.openIssuesAuthored],
  ["Closed issues", activity.closedIssues],
  ["Pull requests", activity.pullRequestsAuthored],
  ["Merged PRs", activity.mergedPullRequests],
  ["Open PRs", activity.openPullRequests]
];

const activityCards = activityMetrics.map((item, index) => {
  const column = index % 3;
  const row = Math.floor(index / 3);

  const x = 40 + column * 294;
  const y = 1032 + row * 43;

  return `
    <g>
      ${text(x, y, item[0], 10, C.muted)}
      ${text(x + 250, y, fmt(item[1]), 13, C.text, 800, "end")}
    </g>`;
}).join("");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${WIDTH}"
  height="${HEIGHT}"
  viewBox="0 0 ${WIDTH} ${HEIGHT}"
  role="img"
  aria-labelledby="dashboard-title dashboard-description"
>
  <title id="dashboard-title">Nene's Divaloper GitHub Statistics</title>
  <desc id="dashboard-description">
    A custom GitHub dashboard for ${esc(displayName)} showing contributions,
    contribution history, yearly commits, programming languages,
    repositories, stars, forks, issues and pull requests.
  </desc>

  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.backgroundLight}"/>
      <stop offset="100%" stop-color="${C.background}"/>
    </linearGradient>

    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.pink}"/>
      <stop offset="100%" stop-color="${C.purple}"/>
    </linearGradient>
  </defs>

  <rect
    x="1" y="1"
    width="${WIDTH - 2}" height="${HEIGHT - 2}"
    rx="20"
    fill="url(#background)"
    stroke="${C.border}"
    stroke-width="1.5"
  />

  <rect x="1" y="1" width="${WIDTH - 2}" height="5" rx="2" fill="url(#accent)"/>

  <circle cx="31" cy="32" r="5" fill="${C.pink}"/>
  <circle cx="47" cy="32" r="5" fill="${C.purple}"/>
  <circle cx="63" cy="32" r="5" fill="${C.green}"/>

  ${text(30, 65, "Nene's Divaloper", 25, C.text, 800)}
  ${text(30, 88, `${displayName} · @${username}`, 11, C.muted)}
  ${text(WIDTH - 30, 39, "MY CODING JOURNEY", 10, C.pinkLight, 800, "end")}
  ${text(WIDTH - 30, 57, "GITHUB STATISTICS", 9, C.muted, 600, "end")}

  ${metricCards}

  ${rect(24, 205, 912, 228)}
  ${sectionTitle(40, 235, "CONTRIBUTION ACTIVITY", "Daily contributions · Last 365 days")}
  ${text(915, 235, `${fmt(contributions.last365Days)} total`, 12, C.pinkLight, 800, "end")}
  ${calendarContent}

  ${rect(24, 449, 912, 155)}
  ${sectionTitle(40, 480, "YEARLY BREAKDOWN", "Contributions and repository commits")}
  ${yearCards}

  ${rect(24, 620, 912, 185)}
  ${sectionTitle(40, 650, "PROGRAMMING LANGUAGES", "Proportions are calculated within each displayed list")}

  ${text(40, 681, "PUBLIC REPOSITORIES", 10, C.pinkLight, 800)}
  ${makeLanguageList(publicLanguages, 40, 704, 385)}

  ${text(500, 681, "ALL ACCESSIBLE REPOSITORIES", 10, C.pinkLight, 800)}
  ${makeLanguageList(accessibleLanguages, 500, 704, 415)}

  ${rect(24, 820, 912, 160)}
  ${sectionTitle(40, 850, "PUBLIC REPOSITORIES", "Repository commits, stars, forks and primary languages")}

  ${text(42, 858, "REPOSITORY", 8, C.subtle, 700)}
  ${text(520, 858, "COMMITS", 8, C.subtle, 700)}
  ${text(670, 858, "STARS", 8, C.subtle, 700)}
  ${text(790, 858, "FORKS", 8, C.subtle, 700)}
  ${text(915, 858, "LANGUAGE", 8, C.subtle, 700, "end")}

  ${repositoryRows}

  ${rect(24, 994, 912, 142)}
  ${sectionTitle(40, 1020, "DEVELOPMENT ACTIVITY", "Issues and pull requests recorded in your statistics")}

  ${activityCards}

  ${text(30, 1150, `Updated ${generatedDate}`, 9, C.subtle)}
  ${text(WIDTH - 30, 1150, "Explore the full dashboard →", 9, C.pinkLight, 700, "end")}
</svg>
`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, svg, "utf8");

console.log(`Custom Divaloper dashboard generated: ${OUTPUT_PATH}`);
console.log(`Contribution calendar entries: ${dailyCalendar.length}`);
console.log(`Contribution years: ${yearlyContributions.length}`);
console.log(`Public languages: ${publicLanguages.length}`);
console.log(`Accessible languages: ${accessibleLanguages.length}`);
console.log(`Public repositories: ${publicRepos.length}`);
