
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const STATS_PATH = path.join(ROOT, "stats.json");
const OUTPUT_PATH = path.join(ROOT, "assets", "github-stats.svg");

if (!fs.existsSync(STATS_PATH)) {
  throw new Error("stats.json is missing. Run generate-stats.js first.");
}

let stats;

try {
  stats = JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
} catch (error) {
  throw new Error(`Could not read stats.json: ${error.message}`);
}

if (!stats.profile || !stats.repositories || !stats.contributions) {
  throw new Error(
    "stats.json must contain profile, repositories, and contributions."
  );
}

if (!Array.isArray(stats.contributions.yearly)) {
  throw new Error("stats.json must contain contributions.yearly as an array.");
}

const C = {
  bg: "#120b18",
  panel: "#201329",
  panelLight: "#2b1936",
  pink: "#ff1493",
  pinkLight: "#ff72bd",
  purple: "#b66dff",
  text: "#fff5fc",
  muted: "#bba8c5",
  border: "#42294e",
  green: "#82edb0",
  empty: "#3a2942"
};

const esc = value =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const number = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const fmt = value => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
};

const pct = value => `${number(value).toFixed(1)}%`;

const contributions = stats.contributions;
const repositories = stats.repositories;
const activity = stats.activity || {};
const repositoryCommits = stats.repositoryCommits || {};

const languages = Array.isArray(stats.allAccessibleLanguages)
  ? stats.allAccessibleLanguages
  : [];

const yearly = [...contributions.yearly].sort(
  (a, b) => number(a.year) - number(b.year)
);

const publicRepos = Array.isArray(repositories.publicDetails)
  ? repositories.publicDetails
  : [];

const languageRows = [...languages]
  .filter(item => item && item.name)
  .map(item => ({
    ...item,
    bytes: Math.max(0, number(item.bytes))
  }))
  .sort((a, b) => b.bytes - a.bytes);

const totalLanguageBytes = languageRows.reduce(
  (sum, item) => sum + item.bytes,
  0
);

const publicCommitRows = publicRepos
  .map(repo => ({
    ...repo,
    commitTotal: Math.max(0, number(repo.commits))
  }))
  .sort((a, b) => b.commitTotal - a.commitTotal);

const publicCommitTotal = publicCommitRows.reduce(
  (sum, repo) => sum + repo.commitTotal,
  0
);

const privateRepoCount = Math.max(0, number(repositories.private));

const privateCommitTotal = Math.max(
  0,
  number(
    repositoryCommits.privateTotal ??
      Math.max(
        0,
        number(repositoryCommits.total) - publicCommitTotal
      )
  )
);

const totalCommits = number(contributions.commitContributionsAllYears);

const metrics = [
  {
    icon: "📈",
    label: "CONTRIBUTIONS",
    value: fmt(contributions.allTime),
    note: "All recorded years"
  },
  {
    icon: "💻",
    label: "COMMIT CONTRIBUTIONS",
    value: fmt(totalCommits),
    note: "GitHub contribution history"
  },
  {
    icon: "📁",
    label: "REPOSITORIES",
    value: fmt(repositories.total),
    note: `${fmt(repositories.public)} public · ${fmt(repositories.private)} private`
  },
  {
    icon: "⭐",
    label: "STARS",
    value: fmt(repositories.starsReceivedOnAllAccessibleRepos),
    note: "Stars received"
  },
  {
    icon: "🍴",
    label: "FORKS",
    value: fmt(repositories.forksOfAllAccessibleRepos),
    note: "Forks received"
  },
  {
    icon: "🧩",
    label: "ISSUES",
    value: fmt(activity.issuesAuthored),
    note: `${fmt(activity.openIssuesAuthored)} open`
  },
  {
    icon: "🔀",
    label: "PULL REQUESTS",
    value: fmt(activity.pullRequestsAuthored),
    note: `${fmt(activity.mergedPullRequests)} merged`
  },
  {
    icon: "🧠",
    label: "LANGUAGES",
    value: fmt(languageRows.length),
    note: "Across accessible repositories"
  }
];

const parts = [];
let y = 0;

function add(markup) {
  parts.push(markup);
}

function rect(
  x,
  top,
  width,
  height,
  fill,
  radius = 12,
  stroke = "none"
) {
  add(
    `<rect x="${x}" y="${top}" width="${width}" height="${height}" ` +
      `rx="${radius}" fill="${fill}" stroke="${stroke}"/>`
  );
}

function text(
  x,
  top,
  value,
  size = 14,
  fill = C.text,
  weight = 400,
  extra = ""
) {
  add(
    `<text x="${x}" y="${top}" fill="${fill}" font-size="${size}" ` +
      `font-weight="${weight}" font-family="Arial, Helvetica, sans-serif" ` +
      `${extra}>${esc(value)}</text>`
  );
}

function line(x1, y1, x2, y2, color = C.border, width = 1) {
  add(
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
      `stroke="${color}" stroke-width="${width}"/>`
  );
}

function section(title, subtitle = "") {
  text(32, y + 22, title, 17, C.pinkLight, 800);

  if (subtitle) {
    text(32, y + 43, subtitle, 11, C.muted, 400);
    y += 55;
  } else {
    y += 34;
  }
}

function panel(x, top, width, height, fill = C.panel) {
  rect(x, top, width, height, fill, 12, C.border);
}

function detailRow(label, value, x, top, width, options = {}) {
  const height = options.height || 30;

  text(
    x + 10,
    top + 19,
    label,
    options.size || 11,
    options.labelColor || C.text,
    500
  );

  text(
    x + width - 10,
    top + 19,
    value,
    options.valueSize || 11,
    options.valueColor || C.pinkLight,
    800,
    'text-anchor="end"'
  );

  if (options.divider !== false) {
    line(x + 8, top + height, x + width - 8, top + height);
  }
}

function graphCell(x, top, size, count, maxCount) {
  let fill = C.empty;

  if (count > 0) {
    const intensity = count / Math.max(1, maxCount);

    if (intensity < 0.25) {
      fill = "#77315f";
    } else if (intensity < 0.5) {
      fill = "#b52b7a";
    } else if (intensity < 0.75) {
      fill = "#e83a9b";
    } else {
      fill = C.pinkLight;
    }
  }

  rect(x, top, size, size, fill, 2);
}

function drawYearGraph(days, x, top, cellSize = 6, gap = 2) {
  if (!Array.isArray(days) || days.length === 0) {
    text(x, top + 20, "Daily contribution data unavailable", 11, C.muted);
    return;
  }

  const validDays = days
    .filter(day => day && day.date)
    .map(day => {
      const date = new Date(`${day.date}T00:00:00Z`);

      return {
        date,
        count: Math.max(0, number(day.count))
      };
    })
    .filter(day => !Number.isNaN(day.date.getTime()));

  if (validDays.length === 0) {
    text(x, top + 20, "Daily contribution data unavailable", 11, C.muted);
    return;
  }

  const maxCount = Math.max(
    1,
    ...validDays.map(day => day.count)
  );

  for (const day of validDays) {
    const date = day.date;

    const startOfYear = new Date(
      Date.UTC(date.getUTCFullYear(), 0, 1)
    );

    const dayOfYear = Math.floor(
      (date.getTime() - startOfYear.getTime()) / 86400000
    );

    const weekday = date.getUTCDay();

    // Keep dates aligned to their real calendar weekday.
    const week = Math.floor(
      (dayOfYear + startOfYear.getUTCDay()) / 7
    );

    graphCell(
      x + week * (cellSize + gap),
      top + weekday * (cellSize + gap),
      cellSize,
      day.count,
      maxCount
    );
  }
}

const width = 1000;
const margin = 32;
const contentWidth = width - margin * 2;
const gap = 12;

const generatedDate = new Date(stats.generatedAt);

const updatedLabel =
  !stats.generatedAt || Number.isNaN(generatedDate.getTime())
    ? "Latest available statistics"
    : `Updated ${generatedDate.toISOString().replace("T", " ").slice(0, 16)} UTC`;

// Use placeholders so the root SVG and background receive the same
// dynamically calculated height when the document is finished.
add(
  `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${width}" height="__SVG_HEIGHT__" ` +
    `viewBox="0 0 ${width} __SVG_HEIGHT__" ` +
    `role="img" aria-labelledby="title description">`
);

add(`<title id="title">Nene's Divaloper GitHub Statistics</title>`);
add(
  `<desc id="description">GitHub statistics for Vunene Hlungwani, including ` +
    `contributions, yearly activity, commits, repositories, issues, pull requests ` +
    `and programming languages.</desc>`
);

add(`
<defs>
  <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#21112b"/>
    <stop offset="100%" stop-color="${C.bg}"/>
  </linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${C.pink}"/>
    <stop offset="100%" stop-color="${C.purple}"/>
  </linearGradient>
</defs>
`);

add(
  `<rect id="backgroundRect" x="0" y="0" width="${width}" ` +
    `height="__SVG_HEIGHT__" fill="url(#background)"/>`
);

y = 0;

// HEADER
text(margin, 44, "NENE'S DIVALOPER", 28, C.text, 850);
text(margin, 70, "GITHUB STATISTICS · VUNENE-HLUNGWANI", 12, C.pinkLight, 700);
text(margin, 94, "MY CODING JOURNEY", 10, C.muted, 700, 'letter-spacing="2"');

text(
  width - margin,
  44,
  "LIVE DATA SNAPSHOT",
  11,
  C.green,
  800,
  'text-anchor="end"'
);

text(
  width - margin,
  68,
  updatedLabel,
  10,
  C.muted,
  400,
  'text-anchor="end"'
);

rect(margin, 110, contentWidth, 4, "url(#accent)", 2);

y = 132;

// DEVELOPER OVERVIEW
section("DEVELOPER OVERVIEW", "Collected from accessible GitHub data");

const columns = 4;
const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
const cardHeight = 88;

metrics.forEach((metric, index) => {
  const col = index % columns;
  const row = Math.floor(index / columns);

  const x = margin + col * (cardWidth + gap);
  const top = y + row * (cardHeight + gap);

  panel(x, top, cardWidth, cardHeight);

  text(x + 14, top + 22, metric.icon, 16);
  text(x + 42, top + 21, metric.label, 9, C.muted, 800);
  text(x + 14, top + 52, metric.value, 25, C.text, 850);
  text(x + 14, top + 73, metric.note, 9, C.muted, 500);
});

y += 2 * (cardHeight + gap) + 14;

// CONTRIBUTION HISTORY
section(
  "CONTRIBUTION HISTORY",
  "Every available year · daily activity graph · private contributions where GitHub provides them"
);

if (yearly.length === 0) {
  panel(margin, y, contentWidth, 48);
  text(margin + 14, y + 29, "No yearly contribution data available.", 12, C.muted);
  y += 60;
} else {
  const yearRowHeight = 94;

  for (const item of [...yearly].reverse()) {
    panel(margin, y, contentWidth, yearRowHeight);

    text(margin + 14, y + 22, String(item.year), 15, C.pinkLight, 850);
    text(margin + 14, y + 42, `${fmt(item.total)} contributions`, 11, C.text, 700);

    // The smaller cells leave enough space for the contribution breakdown.
    drawYearGraph(item.days || [], margin + 170, y + 12, 6, 2);

    const breakdownX = margin + 635;
    const breakdownWidth = contentWidth - 650;

    detailRow(
      "Commit contributions",
      fmt(item.commits),
      breakdownX,
      y + 6,
      breakdownWidth,
      { height: 21, size: 10, valueSize: 10 }
    );

    detailRow(
      "Issue contributions",
      fmt(item.issues),
      breakdownX,
      y + 27,
      breakdownWidth,
      { height: 21, size: 10, valueSize: 10 }
    );

    detailRow(
      "Pull request contributions",
      fmt(item.pullRequests),
      breakdownX,
      y + 48,
      breakdownWidth,
      { height: 21, size: 10, valueSize: 10 }
    );

    detailRow(
      "Review contributions",
      fmt(item.pullRequestReviews),
      breakdownX,
      y + 69,
      breakdownWidth,
      { height: 21, size: 10, valueSize: 10, divider: false }
    );

    y += yearRowHeight + 8;
  }

  panel(margin, y, contentWidth, 36, C.panelLight);

  text(margin + 12, y + 23, "ALL-TIME CONTRIBUTIONS", 10, C.muted, 800);

  text(
    width - margin - 12,
    y + 23,
    fmt(contributions.allTime),
    15,
    C.green,
    850,
    'text-anchor="end"'
  );

  y += 50;
}

// COMMIT BREAKDOWN
section(
  "COMMIT BREAKDOWN",
  "Repository commit counts collected from accessible repositories"
);

const commitRowCount =
  1 + publicCommitRows.length + (privateRepoCount > 0 ? 1 : 0);

const commitPanelHeight = 35 + commitRowCount * 29 + 8;

panel(margin, y, contentWidth, commitPanelHeight);

detailRow(
  "Total commits across accessible repositories",
  fmt(repositoryCommits.total ?? publicCommitTotal + privateCommitTotal),
  margin + 8,
  y + 6,
  contentWidth - 16,
  { height: 29 }
);

let commitY = y + 35;

for (const repo of publicCommitRows) {
  detailRow(
    repo.name,
    `${fmt(repo.commitTotal)} commits`,
    margin + 8,
    commitY,
    contentWidth - 16,
    { height: 29, size: 11, valueSize: 11 }
  );

  commitY += 29;
}

if (privateRepoCount > 0) {
  detailRow(
    `Private repositories (${fmt(privateRepoCount)} · names hidden)`,
    `${fmt(privateCommitTotal)} commits`,
    margin + 8,
    commitY,
    contentWidth - 16,
    { height: 29, size: 11, valueSize: 11, divider: false }
  );
}

y += commitPanelHeight + 18;

// REPOSITORY BREAKDOWN
section(
  "REPOSITORY BREAKDOWN",
  "Private repository names are never displayed"
);

const repoSummaryWidth = (contentWidth - gap * 2) / 3;

const repoSummary = [
  ["TOTAL", fmt(repositories.total)],
  ["PUBLIC", fmt(repositories.public)],
  ["PRIVATE", fmt(repositories.private)]
];

repoSummary.forEach((item, index) => {
  const x = margin + index * (repoSummaryWidth + gap);

  panel(x, y, repoSummaryWidth, 62);
  text(x + 12, y + 21, item[0], 10, C.muted, 800);
  text(x + 12, y + 47, item[1], 22, C.text, 850);
});

y += 76;

const repoDetails = publicRepos;
const repoHeight = Math.max(1, repoDetails.length) * 38 + 12;

panel(margin, y, contentWidth, repoHeight);

if (repoDetails.length === 0) {
  text(margin + 14, y + 29, "No public repository details available.", 12, C.muted);
} else {
  let repoY = y + 4;

  for (const repo of repoDetails) {
    text(margin + 14, repoY + 20, repo.name, 11, C.text, 750);

    text(
      margin + 14,
      repoY + 33,
      repo.language || "Language not specified",
      9,
      C.muted,
      400
    );

    text(
      width - margin - 14,
      repoY + 20,
      `★ ${fmt(repo.stars)}   ·   Forks ${fmt(repo.forks)}`,
      10,
      C.pinkLight,
      800,
      'text-anchor="end"'
    );

    if (repo.url) {
      add(
        `<a href="${esc(repo.url)}" target="_blank">` +
          `<title>${esc(repo.name)} on GitHub</title>` +
          `<rect x="${margin + 8}" y="${repoY}" ` +
          `width="${contentWidth - 16}" height="36" fill="transparent"/>` +
          `</a>`
      );
    }

    line(margin + 10, repoY + 37, width - margin - 10, repoY + 37);

    repoY += 38;
  }
}

y += repoHeight + 18;

// ISSUES AND PULL REQUESTS
section(
  "ISSUES & PULL REQUESTS",
  "Authored activity returned by GitHub Search"
);

const halfWidth = (contentWidth - gap) / 2;
const activityHeight = 140;

panel(margin, y, halfWidth, activityHeight);

text(margin + 14, y + 25, "ISSUES", 13, C.pinkLight, 850);

detailRow(
  "Authored",
  fmt(activity.issuesAuthored),
  margin + 8,
  y + 34,
  halfWidth - 16
);

detailRow(
  "Open",
  fmt(activity.openIssuesAuthored),
  margin + 8,
  y + 64,
  halfWidth - 16
);

detailRow(
  "Closed",
  fmt(activity.closedIssues),
  margin + 8,
  y + 94,
  halfWidth - 16,
  { divider: false }
);

const prX = margin + halfWidth + gap;

panel(prX, y, halfWidth, activityHeight);

text(prX + 14, y + 25, "PULL REQUESTS", 13, C.pinkLight, 850);

detailRow(
  "Authored",
  fmt(activity.pullRequestsAuthored),
  prX + 8,
  y + 34,
  halfWidth - 16
);

detailRow(
  "Open",
  fmt(activity.openPullRequests),
  prX + 8,
  y + 64,
  halfWidth - 16
);

detailRow(
  "Merged",
  fmt(activity.mergedPullRequests),
  prX + 8,
  y + 94,
  halfWidth - 16,
  { divider: false }
);

y += activityHeight + 18;

panel(margin, y, contentWidth, 48, C.panelLight);

text(margin + 14, y + 19, "CLOSED WITHOUT MERGING", 10, C.muted, 800);
text(margin + 14, y + 37, fmt(activity.closedUnmergedPullRequests), 13, C.text, 850);

text(
  width - margin - 14,
  y + 30,
  `Review contributions · ${fmt(contributions.pullRequestReviewsAllYears)}`,
  12,
  C.pinkLight,
  800,
  'text-anchor="end"'
);

y += 64;

// PROGRAMMING LANGUAGES
section(
  "PROGRAMMING LANGUAGES",
  "Combined byte totals from accessible public and private repositories"
);

const languageRowHeight = 39;
const languagePanelHeight = Math.max(1, languageRows.length) * languageRowHeight + 16;

panel(margin, y, contentWidth, languagePanelHeight);

if (languageRows.length === 0 || totalLanguageBytes === 0) {
  text(margin + 14, y + 30, "No language data available.", 12, C.muted);
} else {
  let languageY = y + 8;

  for (const language of languageRows) {
    const percentage = (language.bytes / totalLanguageBytes) * 100;

    text(
      margin + 14,
      languageY + 14,
      language.name,
      11,
      C.text,
      750
    );

    text(
      width - margin - 14,
      languageY + 14,
      `${pct(percentage)} · ${fmt(language.bytes)} bytes`,
      10,
      C.muted,
      600,
      'text-anchor="end"'
    );

    const barX = margin + 14;
    const barY = languageY + 21;
    const barWidth = contentWidth - 28;
    const filledWidth = Math.min(
      barWidth,
      Math.max(0, barWidth * percentage / 100)
    );

    rect(barX, barY, barWidth, 7, C.empty, 4);

    if (filledWidth > 0) {
      rect(barX, barY, filledWidth, 7, "url(#accent)", 4);
    }

    languageY += languageRowHeight;
  }
}

y += languagePanelHeight + 20;

// FOOTER
line(margin, y, width - margin, y);

text(margin, y + 23, "NENE'S DIVALOPER", 10, C.pinkLight, 850);

text(
  width - margin,
  y + 23,
  "Generated automatically from GitHub statistics",
  10,
  C.muted,
  400,
  'text-anchor="end"'
);

y += 42;

// FINALIZE DYNAMIC SVG HEIGHT
const finalSvg = parts
  .join("\n")
  .replaceAll("__SVG_HEIGHT__", String(y));

if (
  !finalSvg.includes(`<svg xmlns="http://www.w3.org/2000/svg"`) ||
  !finalSvg.includes("</svg>") ||
  !finalSvg.includes(`height="${y}"`) ||
  !finalSvg.includes(`viewBox="0 0 ${width} ${y}"`)
) {
  throw new Error("Generated SVG failed its basic structure validation.");
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

fs.writeFileSync(
  OUTPUT_PATH,
  `${finalSvg}\n`,
  "utf8"
);

console.log(`Generated: ${OUTPUT_PATH}`);
console.log(`SVG dimensions: ${width} x ${y}`);
console.log(`Contribution years included: ${yearly.length}`);
console.log(`Public repositories listed: ${publicRepos.length}`);
console.log(`Private repository names displayed: 0`);
console.log(`Languages included: ${languageRows.length}`);
