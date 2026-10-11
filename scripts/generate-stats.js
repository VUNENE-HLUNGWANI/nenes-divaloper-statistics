const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.GH_STATS_TOKEN;
const API = "https://api.github.com";
const GRAPHQL_API = `${API}/graphql`;

if (!TOKEN) {
  throw new Error("GH_STATS_TOKEN is missing.");
}

const API_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

async function github(endpoint) {
  const response = await fetch(`${API}${endpoint}`, {
    headers: API_HEADERS
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `GitHub API error ${response.status}: ${endpoint}\n${details}`
    );
  }

  return response.json();
}

async function graphql(query, variables = {}) {
  const response = await fetch(GRAPHQL_API, {
    method: "POST",
    headers: {
      ...API_HEADERS,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  const result = await response.json();

  if (!response.ok || result.errors) {
    const messages = (result.errors || [])
      .map(error => error.message)
      .join("; ");

    throw new Error(
      `GitHub GraphQL API error ${response.status}: ` +
      `${messages || response.statusText}`
    );
  }

  return result.data;
}

async function getAllRepositories() {
  const repositories = [];

  for (let page = 1; ; page++) {
    const batch = await github(
      `/user/repos?visibility=all&affiliation=owner&per_page=100&page=${page}&sort=updated`
    );

    repositories.push(...batch);

    if (batch.length < 100) break;
  }

  return repositories;
}

async function searchCount(query) {
  const result = await github(
    `/search/issues?q=${encodeURIComponent(query)}&per_page=1`
  );

  return result.total_count;
}

async function getContributionYears(username) {
  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  const data = await graphql(query, { username });

  if (!data.user) {
    throw new Error(`GitHub user not found: ${username}`);
  }

  return data.user.contributionsCollection.contributionYears;
}

async function getContributionPeriod(username, from, to) {
  const maxRange = 365 * 24 * 60 * 60 * 1000;

  if (to.getTime() - from.getTime() > maxRange) {
    throw new Error(
      `Contribution date range exceeds one year: ` +
      `${from.toISOString()} to ${to.toISOString()}`
    );
  }

  const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                weekday
                contributionCount
                contributionLevel
              }
            }
          }
        }
      }
    }
  `;

  const data = await graphql(query, {
    username,
    from: from.toISOString(),
    to: to.toISOString()
  });

  if (!data.user) {
    throw new Error(`GitHub user not found: ${username}`);
  }

  return data.user.contributionsCollection;
}

function getDailyContributions(calendar, year, now) {
  const byDate = new Map();

  for (const day of calendar.weeks.flatMap(
    week => week.contributionDays
  )) {
    if (day.date.startsWith(`${year}-`)) {
      const count = Number(day.contributionCount || 0);

      byDate.set(day.date, {
        date: day.date,
        weekday: day.weekday,
        count,
        level: day.contributionLevel ||
          (count > 0 ? "FIRST_QUARTILE" : "NONE")
      });
    }
  }

  const start = new Date(Date.UTC(year, 0, 1));

  const end = year === now.getUTCFullYear()
    ? new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ))
    : new Date(Date.UTC(year + 1, 0, 1) - 86400000);

  const days = [];

  for (
    const cursor = new Date(start);
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10);

    days.push(byDate.get(date) || {
      date,
      weekday: cursor.getUTCDay(),
      count: 0,
      level: "NONE"
    });
  }

  return days;
}

async function getContributionYearPeriod(username, year, now) {
  const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0));

  const to = year === now.getUTCFullYear()
    ? now
    : new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0) - 1000);

  if (
    to.getTime() - from.getTime() <=
    365 * 24 * 60 * 60 * 1000
  ) {
    return getContributionPeriod(username, from, to);
  }

  const middle = new Date(Date.UTC(year, 6, 1, 0, 0, 0));

  const firstHalf = await getContributionPeriod(
    username,
    from,
    new Date(middle.getTime() - 1000)
  );

  const secondHalf = await getContributionPeriod(
    username,
    middle,
    to
  );

  const fields = [
    "totalCommitContributions",
    "totalIssueContributions",
    "totalPullRequestContributions",
    "totalPullRequestReviewContributions",
    "restrictedContributionsCount"
  ];

  const combined = {};

  for (const field of fields) {
    combined[field] = firstHalf[field] + secondHalf[field];
  }

  combined.contributionCalendar = {
    totalContributions:
      firstHalf.contributionCalendar.totalContributions +
      secondHalf.contributionCalendar.totalContributions,

    weeks: [
      ...firstHalf.contributionCalendar.weeks,
      ...secondHalf.contributionCalendar.weeks
    ]
  };

  return combined;
}

async function getContributionStats(username, accountCreatedAt) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const contributionYears = await getContributionYears(username);

  const accountCreationYear = accountCreatedAt
    ? new Date(accountCreatedAt).getUTCFullYear()
    : currentYear;

  const earliestYear = Math.min(
    accountCreationYear,
    ...(contributionYears.length
      ? contributionYears
      : [currentYear])
  );

  const yearly = [];

  for (
    let year = earliestYear;
    year <= currentYear;
    year++
  ) {
    const collection = await getContributionYearPeriod(
      username,
      year,
      now
    );

    const calendar = collection.contributionCalendar;
    const days = getDailyContributions(calendar, year, now);

    const dailyTotal = days.reduce(
      (sum, day) => sum + day.count,
      0
    );

    yearly.push({
      year,
      total: calendar.totalContributions,
      dailyTotal,
      dailyTotalsMatch: dailyTotal === calendar.totalContributions,
      commits: collection.totalCommitContributions,
      issues: collection.totalIssueContributions,
      pullRequests: collection.totalPullRequestContributions,
      pullRequestReviews:
        collection.totalPullRequestReviewContributions,
      restrictedContributions:
        collection.restrictedContributionsCount,
      days
    });

    console.log(
      `${year}: contributions=${calendar.totalContributions}, ` +
      `daily sum=${dailyTotal}, ` +
      `graph commits=${collection.totalCommitContributions}`
    );
  }

  // Separate rolling 365-day statistic.
  const endDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));

  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 364);

  const rolling = await getContributionPeriod(
    username,
    startDate,
    now
  );

  const startText = startDate.toISOString().slice(0, 10);
  const endText = endDate.toISOString().slice(0, 10);

  const last365DaysCalendar =
    rolling.contributionCalendar.weeks
      .flatMap(week => week.contributionDays)
      .filter(day =>
        day.date >= startText &&
        day.date <= endText
      )
      .map(day => ({
        date: day.date,
        weekday: day.weekday,
        count: day.contributionCount,
        level: day.contributionLevel
      }));

  const sum = key => yearly.reduce(
    (total, item) => total + Number(item[key] || 0),
    0
  );

  const dailyRollingTotal = last365DaysCalendar.reduce(
    (total, day) => total + day.count,
    0
  );

  console.log(
    `Last 365 days: calendar total=` +
    `${rolling.contributionCalendar.totalContributions}, ` +
    `daily sum=${dailyRollingTotal}, ` +
    `days returned=${last365DaysCalendar.length}`
  );

  return {
    allTime: sum("total"),
    last365Days:
      rolling.contributionCalendar.totalContributions,
    last365DaysCalendar,

    commitContributionsAllYears: sum("commits"),
    commitContributionsLast365Days:
      rolling.totalCommitContributions,

    issuesAllYears: sum("issues"),
    pullRequestsAllYears: sum("pullRequests"),
    pullRequestReviewsAllYears: sum("pullRequestReviews"),

    restrictedContributionsAllYears:
      sum("restrictedContributions"),
    restrictedContributionsLast365Days:
      rolling.restrictedContributionsCount,

    earliestYear,
    currentYear,
    yearly,

    allHistoryCalendar: yearly.flatMap(item => item.days),

    currentYearCalendar:
      yearly.find(item => item.year === currentYear)?.days || []
  };
}

async function getRepositoryCommits(repositories, username) {
  const yearlyTotals = {};
  const perRepository = [];

  let total = 0;
  let currentYearTotal = 0;

  const currentYear = new Date().getUTCFullYear();

  for (const repo of repositories) {
    let repoTotal = 0;
    let repoCurrentYear = 0;

    for (let page = 1; ; page++) {
      let commits;

      try {
        commits = await github(
          `/repos/${repo.full_name}/commits?author=${encodeURIComponent(username)}&per_page=100&page=${page}`
        );
      } catch (error) {
        if (
          String(error.message).includes(
            "GitHub API error 409"
          )
        ) {
          break;
        }

        throw error;
      }

      for (const commit of commits) {
        repoTotal++;

        const date =
          commit.commit?.author?.date ||
          commit.commit?.committer?.date;

        if (!date) continue;

        const year = new Date(date).getUTCFullYear();

        yearlyTotals[year] =
          (yearlyTotals[year] || 0) + 1;

        if (year === currentYear) {
          repoCurrentYear++;
        }
      }

      if (commits.length < 100) break;
    }

    total += repoTotal;
    currentYearTotal += repoCurrentYear;

    perRepository.push({
      name: repo.name,
      url: repo.html_url,
      isPrivate: repo.private,
      total: repoTotal,
      currentYear: repoCurrentYear
    });

    console.log(
      `Repository commits: ${repo.name}=${repoTotal}; ` +
      `${currentYear}=${repoCurrentYear}`
    );
  }

  return {
    total,
    currentYear,
    currentYearTotal,

    yearly: Object.entries(yearlyTotals)
      .map(([year, count]) => ({
        year: Number(year),
        count
      }))
      .sort((a, b) => a.year - b.year),

    repositories: perRepository
  };
}

function aggregateLanguages(languageObjects) {
  const totals = {};

  for (const languages of languageObjects) {
    for (const [language, bytes] of Object.entries(languages)) {
      totals[language] = (totals[language] || 0) + bytes;
    }
  }

  return Object.entries(totals)
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

async function getLanguages(repositories) {
  const results = await Promise.all(
    repositories.map(async repo => ({
      isPrivate: repo.private,
      languages: await github(
        repo.languages_url.replace(API, "")
      )
    }))
  );

  return {
    allAccessibleLanguages: aggregateLanguages(
      results.map(item => item.languages)
    ),

    publicLanguages: aggregateLanguages(
      results
        .filter(item => !item.isPrivate)
        .map(item => item.languages)
    )
  };
}

async function main() {
  console.log("Collecting GitHub statistics...");

  const profile = await github("/user");
  const username = profile.login;

  const repositories = await getAllRepositories();
  const publicRepos = repositories.filter(repo => !repo.private);
  const privateRepos = repositories.filter(repo => repo.private);

  console.log(
    `Repositories found: ${repositories.length} total, ` +
    `${publicRepos.length} public, ${privateRepos.length} private.`
  );

  console.log("Collecting repository commits...");

  const repositoryCommits = await getRepositoryCommits(
    repositories,
    username
  );

  console.log("Collecting languages...");

  const languages = await getLanguages(repositories);

  console.log("Collecting contribution graph statistics...");

  const contributions = await getContributionStats(
    username,
    profile.created_at
  );

  console.log("Collecting issue and pull request totals...");

  const [
    issuesAuthored,
    openIssuesAuthored,
    pullRequestsAuthored,
    openPullRequests,
    mergedPullRequests
  ] = await Promise.all([
    searchCount(`author:${username} type:issue`),
    searchCount(`author:${username} type:issue is:open`),
    searchCount(`author:${username} type:pr`),
    searchCount(`author:${username} type:pr is:open`),
    searchCount(`author:${username} type:pr is:merged`)
  ]);

  const publicRepositoryDetails = publicRepos.map(repo => ({
    name: repo.name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,

    updatedAt: repo.updated_at,

    commits:
      repositoryCommits.repositories.find(
        item => item.name === repo.name
      )?.total || 0,

    commitsCurrentYear:
      repositoryCommits.repositories.find(
        item => item.name === repo.name
      )?.currentYear || 0
  }));

  const sum = (items, key) => items.reduce(
    (total, item) => total + Number(item[key] || 0),
    0
  );

  const stats = {
    generatedAt: new Date().toISOString(),

    profile: {
      username,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      profileUrl: profile.html_url
    },

    repositories: {
      total: repositories.length,
      public: publicRepos.length,
      private: privateRepos.length,

      starsReceivedOnAllAccessibleRepos:
        sum(repositories, "stargazers_count"),

      starsReceivedOnPublicRepos:
        sum(publicRepos, "stargazers_count"),

      forksOfAllAccessibleRepos:
        sum(repositories, "forks_count"),

      forksOfPublicRepos:
        sum(publicRepos, "forks_count"),

      publicDetails: publicRepositoryDetails
    },

    contributions,
    repositoryCommits,

    activity: {
      issuesAuthored,
      openIssuesAuthored,

      closedIssues: Math.max(
        0,
        issuesAuthored - openIssuesAuthored
      ),

      pullRequestsAuthored,
      openPullRequests,
      mergedPullRequests,

      closedUnmergedPullRequests: Math.max(
        0,
        pullRequestsAuthored -
          openPullRequests -
          mergedPullRequests
      )
    },

    publicLanguages: languages.publicLanguages,
    allAccessibleLanguages: languages.allAccessibleLanguages
  };

  const outputPath = path.join(process.cwd(), "stats.json");

  fs.writeFileSync(
    outputPath,
    JSON.stringify(stats, null, 2) + "\n"
  );

  console.log(`Statistics saved to ${outputPath}`);

  console.log(
    `Contributions in last 365 days: ${contributions.last365Days}`
  );

  console.log(
    `Full history calendar: ` +
    `${contributions.allHistoryCalendar.length} days, ` +
    `from ${contributions.earliestYear} through ` +
    `${contributions.currentYear}.`
  );

  console.log(
    `Contribution graph commits in ${contributions.currentYear}: ` +
    `${contributions.yearly.find(
      item => item.year === contributions.currentYear
    )?.commits || 0}`
  );

  console.log(
    `Repository commits in ${repositoryCommits.currentYear}: ` +
    `${repositoryCommits.currentYearTotal}`
  );

  console.log(
    `Repository totals: ${repositories.length} total, ` +
    `${publicRepos.length} public, ${privateRepos.length} private`
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
