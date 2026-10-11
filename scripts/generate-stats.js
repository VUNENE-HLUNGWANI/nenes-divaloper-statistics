
const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.GH_STATS_TOKEN;
const API = "https://api.github.com";
const GRAPHQL_API = `${API}/graphql`;

if (!TOKEN) {
  throw new Error("GH_STATS_TOKEN is missing.");
}

async function github(endpoint) {
  const response = await fetch(`${API}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
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
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
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
  let page = 1;

  while (true) {
    const batch = await github(
      `/user/repos?visibility=all&affiliation=owner` +
      `&per_page=100&page=${page}&sort=updated`
    );

    repositories.push(...batch);

    if (batch.length < 100) {
      break;
    }

    page++;
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
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;

  if (to.getTime() - from.getTime() > oneYearMs) {
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
                contributionCount
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

function getDailyContributions(calendar, year) {
  return calendar.weeks
    .flatMap(week => week.contributionDays)
    .filter(day => day.date.startsWith(`${year}-`))
    .map(day => ({
      date: day.date,
      count: day.contributionCount
    }));
}

async function getContributionStats(username) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const yearsWithContributions =
    await getContributionYears(username);

  const earliestYear = yearsWithContributions.length
    ? Math.min(...yearsWithContributions)
    : currentYear;

  const yearly = [];

  for (let year = earliestYear; year <= currentYear; year++) {
    // Each request covers one calendar year only.
    const from = new Date(Date.UTC(year, 0, 1));

    const to = year === currentYear
      ? now
      : new Date(Date.UTC(year + 1, 0, 1) - 1000);

    const collection = await getContributionPeriod(
      username,
      from,
      to
    );

    const calendar = collection.contributionCalendar;
    const days = getDailyContributions(calendar, year);

    const dailyTotal = days.reduce(
      (sum, day) => sum + day.count,
      0
    );

    yearly.push({
      year,
      total: calendar.totalContributions,
      dailyTotal,
      dailyTotalsMatch:
        dailyTotal === calendar.totalContributions,
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
      `${year}: GitHub total=${calendar.totalContributions}, ` +
      `daily sum=${dailyTotal}`
    );
  }

  const sum = key =>
    yearly.reduce(
      (total, item) => total + Number(item[key] || 0),
      0
    );

  return {
    allTime: sum("total"),
    commitContributionsAllYears: sum("commits"),
    issuesAllYears: sum("issues"),
    pullRequestsAllYears: sum("pullRequests"),
    pullRequestReviewsAllYears: sum("pullRequestReviews"),
    restrictedContributionsAllYears:
      sum("restrictedContributions"),
    earliestYear,
    currentYear,
    yearly,
    currentYearCalendar:
      yearly.find(item => item.year === currentYear)?.days || []
  };
}

function aggregateLanguages(repositories) {
  const totals = {};

  for (const repo of repositories) {
    for (const [language, bytes] of Object.entries(repo)) {
      totals[language] = (totals[language] || 0) + bytes;
    }
  }

  return Object.entries(totals)
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

async function getLanguages(repositories) {
  const languageResults = await Promise.all(
    repositories.map(async repo => {
      const languages = await github(
        repo.languages_url.replace(API, "")
      );

      return {
        isPrivate: repo.private,
        languages
      };
    })
  );

  return {
    allAccessibleLanguages: aggregateLanguages(
      languageResults.map(result => result.languages)
    ),

    publicLanguages: aggregateLanguages(
      languageResults
        .filter(result => !result.isPrivate)
        .map(result => result.languages)
    )
  };
}

async function main() {
  console.log("Collecting GitHub statistics...");

  const profile = await github("/user");
  const username = profile.login;

  // Diagnostic: request only the current calendar year to date.
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const contributionTest = await getContributionPeriod(
    username,
    new Date(Date.UTC(currentYear, 0, 1)),
    now
  );

  console.log("CONTRIBUTION PERMISSION TEST:", {
    username,
    totalContributions:
      contributionTest.contributionCalendar.totalContributions,
    restrictedContributions:
      contributionTest.restrictedContributionsCount
  });

  const repositories = await getAllRepositories();

  const publicRepos = repositories.filter(repo => !repo.private);
  const privateRepos = repositories.filter(repo => repo.private);

  const starsAllAccessible = repositories.reduce(
    (sum, repo) => sum + repo.stargazers_count,
    0
  );

  const forksAllAccessible = repositories.reduce(
    (sum, repo) => sum + repo.forks_count,
    0
  );

  const starsPublic = publicRepos.reduce(
    (sum, repo) => sum + repo.stargazers_count,
    0
  );

  const forksPublic = publicRepos.reduce(
    (sum, repo) => sum + repo.forks_count,
    0
  );

  console.log("Collecting languages...");

  const languages = await getLanguages(repositories);

  console.log("Collecting yearly contribution history...");

  const contributions = await getContributionStats(username);

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

  const closedIssues = Math.max(
    0,
    issuesAuthored - openIssuesAuthored
  );

  const closedUnmergedPullRequests = Math.max(
    0,
    pullRequestsAuthored -
      openPullRequests -
      mergedPullRequests
  );

  const publicRepositoryDetails = publicRepos.map(repo => ({
    name: repo.name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,
    updatedAt: repo.updated_at
  }));

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
      starsReceivedOnAllAccessibleRepos: starsAllAccessible,
      starsReceivedOnPublicRepos: starsPublic,
      forksOfAllAccessibleRepos: forksAllAccessible,
      forksOfPublicRepos: forksPublic,
      publicDetails: publicRepositoryDetails
    },

    contributions,

    activity: {
      issuesAuthored,
      openIssuesAuthored,
      closedIssues,
      pullRequestsAuthored,
      openPullRequests,
      mergedPullRequests,
      closedUnmergedPullRequests
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
  console.log(`Total contributions: ${contributions.allTime}`);

  console.log("Yearly contribution summary:");

  for (const item of contributions.yearly) {
    console.log(
      `${item.year}: ${item.total} contributions ` +
      `(daily sum: ${item.dailyTotal})`
    );
  }

  console.log(
    `Calendar years included: ` +
    `${contributions.earliestYear}-${contributions.currentYear}`
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
