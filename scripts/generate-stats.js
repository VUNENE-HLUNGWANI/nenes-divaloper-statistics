const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.GH_STATS_TOKEN;
const API = "https://api.github.com";
const GRAPHQL_API = `${API}/graphql`;
const API_VERSION = "2022-11-28";

if (!TOKEN) {
  throw new Error("GH_STATS_TOKEN is missing.");
}

async function github(endpoint) {
  const response = await fetch(`${API}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION
    }
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error ${response.status}: ${endpoint}`
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

  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL API error ${response.status}`
    );
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(
      result.errors.map(error => error.message).join("; ")
    );
  }

  return result.data;
}

// Get every repository owned by the authenticated account,
// including accessible private repositories.
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

  return data.user.contributionsCollection.contributionYears;
}

async function getContributionPeriod(username, from, to) {
  const query = `
    query(
      $username: String!,
      $from: DateTime!,
      $to: DateTime!
    ) {
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
                weekday
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

  return data.user.contributionsCollection;
}

function getDailyContributions(calendar) {
  return calendar.weeks
    .flatMap(week => week.contributionDays)
    .map(day => ({
      date: day.date,
      count: day.contributionCount,
      weekday: day.weekday
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getContributionStats(username) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const years = await getContributionYears(username);
  const yearly = [];

  // Fetch each calendar year separately. GitHub limits the
  // time span allowed in an individual contributions query.
  for (const year of [...years].sort((a, b) => a - b)) {
    const from = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));

    // Use the current time for the current year; otherwise,
    // stop just before the next calendar year starts.
    const to = year === currentYear
      ? now
      : new Date(nextYearStart.getTime() - 1000);

    const collection = await getContributionPeriod(
      username,
      from,
      to
    );

    const calendar = collection.contributionCalendar;

    yearly.push({
      year,
      total: calendar.totalContributions,
      commits: collection.totalCommitContributions,
      issues: collection.totalIssueContributions,
      pullRequests: collection.totalPullRequestContributions,
      pullRequestReviews:
        collection.totalPullRequestReviewContributions,
      restrictedContributions:
        collection.restrictedContributionsCount,
      days: getDailyContributions(calendar)
    });
  }

  // This is the rolling 365-day period, not the current
  // calendar year and not a single day's contribution count.
  const last365Start = new Date(
    now.getTime() - 365 * 24 * 60 * 60 * 1000
  );

  const recent = await getContributionPeriod(
    username,
    last365Start,
    now
  );

  const recentCalendar = recent.contributionCalendar;
  const currentYearData = yearly.find(
    item => item.year === currentYear
  );

  return {
    // Genuine total across the returned calendar years.
    allTime: yearly.reduce(
      (sum, item) => sum + item.total,
      0
    ),

    // Main rolling-year figure for the dashboard.
    last365Days: recentCalendar.totalContributions,

    commitContributionsAllYears: yearly.reduce(
      (sum, item) => sum + item.commits,
      0
    ),

    commitContributionsLast365Days:
      recent.totalCommitContributions,

    issuesAllYears: yearly.reduce(
      (sum, item) => sum + item.issues,
      0
    ),

    pullRequestsAllYears: yearly.reduce(
      (sum, item) => sum + item.pullRequests,
      0
    ),

    pullRequestReviewsAllYears: yearly.reduce(
      (sum, item) => sum + item.pullRequestReviews,
      0
    ),

    restrictedContributionsLast365Days:
      recent.restrictedContributionsCount,

    currentYear,

    // Rolling 365-day daily data for the full contribution graph.
    last365DaysCalendar: getDailyContributions(recentCalendar),

    // Retain calendar-year data for yearly breakdowns.
    yearly,

    // Required by the existing HTML's calendar-year graph.
    currentYearCalendar: currentYearData
      ? currentYearData.days
      : []
  };
}

// Count commits authored by this GitHub user on each
// repository's default branch, including accessible private repos.
// This is separate from contribution-graph commit counts.
async function getRepositoryCommitCount(repo, username) {
  let page = 1;
  let total = 0;

  while (true) {
    const endpoint =
      `/repos/${repo.full_name}/commits` +
      `?author=${encodeURIComponent(username)}` +
      `&per_page=100&page=${page}`;

    let batch;

    try {
      batch = await github(endpoint);
    } catch (error) {
      // Empty repositories can return HTTP 409 for this endpoint.
      if (String(error.message).includes("409")) {
        return 0;
      }

      throw error;
    }

    total += batch.length;

    if (batch.length < 100) {
      break;
    }

    page++;
  }

  return total;
}

async function getRepositoryCommitStats(repositories, username) {
  const results = [];

  // Sequential requests help avoid sending too many requests
  // to the API at once.
  for (const repo of repositories) {
    console.log(`Counting commits: ${repo.full_name}`);

    const count = await getRepositoryCommitCount(repo, username);

    results.push({
      fullName: repo.full_name,
      isPrivate: repo.private,
      count
    });
  }

  return {
    total: results.reduce((sum, item) => sum + item.count, 0),

    // Only public repository identities are exposed in this list.
    publicDetails: results
      .filter(item => !item.isPrivate)
      .map(item => ({
        name: item.fullName.split("/").pop(),
        commits: item.count
      }))
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
      languageResults.map(item => item.languages)
    ),

    publicLanguages: aggregateLanguages(
      languageResults
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

  console.log("Collecting language statistics...");
  const languages = await getLanguages(repositories);

  console.log("Collecting contribution history...");
  const contributions = await getContributionStats(username);

  console.log("Counting commits across accessible repositories...");
  const repositoryCommits = await getRepositoryCommitStats(
    repositories,
    username
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

  // Private repository names, descriptions and URLs are never
  // written into the public repository-details list.
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

    contributions: {
      ...contributions,

      // A separate actual repository-commit count.
      // This counts commits authored by this user on each
      // repository's default branch.
      repositoryCommitsAllRepos: repositoryCommits.total,
      repositoryCommitsPublicDetails:
        repositoryCommits.publicDetails
    },

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

  console.log("\nStatistics generated successfully.");
  console.log(`Username: ${username}`);
  console.log(`Repositories: ${repositories.length}`);
  console.log(`Public repositories: ${publicRepos.length}`);
  console.log(`Private repositories: ${privateRepos.length}`);
  console.log(
    `Contributions in the last 365 days: ${contributions.last365Days}`
  );
  console.log(
    `All-time calendar-year contributions: ${contributions.allTime}`
  );
  console.log(
    `Contribution-graph commits across years: ` +
    `${contributions.commitContributionsAllYears}`
  );
  console.log(
    `Repository commits across default branches: ` +
    `${repositoryCommits.total}`
  );
  console.log(`Issues authored: ${issuesAuthored}`);
  console.log(`Pull requests authored: ${pullRequestsAuthored}`);
  console.log(
    `Accessible languages: ${languages.allAccessibleLanguages.length}`
  );
  console.log(`Saved to: ${outputPath}`);
}

main().catch(error => {
  console.error("Failed to generate GitHub statistics:");
  console.error(error);
  process.exitCode = 1;
});
