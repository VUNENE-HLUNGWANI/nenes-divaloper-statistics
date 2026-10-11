
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

async function getAllRepositories() {
  const repositories = [];
  let page = 1;

  while (true) {
    const batch = await github(
      `/user/repos?visibility=all&affiliation=owner` +
      `&per_page=100&page=${page}&sort=updated`
    );

    repositories.push(...batch);

    if (batch.length < 100) break;
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
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
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

  return data.user.contributionsCollection;
}

function getDailyContributions(calendar) {
  return calendar.weeks
    .flatMap(week => week.contributionDays)
    .map(day => ({
      date: day.date,
      count: day.contributionCount
    }));
}

async function getContributionStats(username) {
  const now = new Date();
  const years = await getContributionYears(username);
  const yearly = [];

  for (const year of years) {
    const from = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(
      Date.UTC(year, 11, 31, 23, 59, 59)
    );
    const to = yearEnd < now ? yearEnd : now;

    const collection = await getContributionPeriod(
      username,
      from,
      to
    );

    yearly.push({
      year,
      total: collection.contributionCalendar.totalContributions,
      commits: collection.totalCommitContributions,
      issues: collection.totalIssueContributions,
      pullRequests: collection.totalPullRequestContributions,
      pullRequestReviews:
        collection.totalPullRequestReviewContributions,
      days: getDailyContributions(
        collection.contributionCalendar
      )
    });
  }

  const last365Start = new Date(
    now.getTime() - 365 * 24 * 60 * 60 * 1000
  );

  const recent = await getContributionPeriod(
    username,
    last365Start,
    now
  );

  return {
    allTime: yearly.reduce((sum, year) => sum + year.total, 0),

    last365Days:
      recent.contributionCalendar.totalContributions,

    commitContributionsAllYears: yearly.reduce(
      (sum, year) => sum + year.commits,
      0
    ),

    commitContributionsLast365Days:
      recent.totalCommitContributions,

    issuesAllYears: yearly.reduce(
      (sum, year) => sum + year.issues,
      0
    ),

    pullRequestsAllYears: yearly.reduce(
      (sum, year) => sum + year.pullRequests,
      0
    ),

    pullRequestReviewsAllYears: yearly.reduce(
      (sum, year) => sum + year.pullRequestReviews,
      0
    ),

    yearly,

    last365DaysCalendar: getDailyContributions(
      recent.contributionCalendar
    )
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
  const repositories = await getAllRepositories();

  const publicRepos = repositories.filter(repo => !repo.private);
  const privateRepos = repositories.filter(repo => repo.private);

  // Aggregate totals across all accessible owned repositories.
  // Private repository identities are never added to public details.
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

  console.log("Collecting contribution history...");
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

  // Closed, unmerged PRs are separated from merged PRs.
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
  console.log(`Repositories: ${repositories.length}`);
  console.log(`Contributions across years: ${contributions.allTime}`);
  console.log(
    `Commit contributions across years: ${contributions.commitContributionsAllYears}`
  );
  console.log(`Issues authored: ${issuesAuthored}`);
  console.log(`Pull requests authored: ${pullRequestsAuthored}`);
  console.log(
    `Accessible languages: ${languages.allAccessibleLanguages.length}`
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
