
const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.GH_STATS_TOKEN;
const API = "https://api.github.com";

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

async function main() {
  console.log("Collecting GitHub statistics...");

  const profile = await github("/user");
  const repositories = await getAllRepositories();

  const publicRepos = repositories.filter(repo => !repo.private);
  const privateRepos = repositories.filter(repo => repo.private);

  let totalStars = 0;
  let totalForks = 0;
  const languages = {};

  for (const repo of publicRepos) {
    totalStars += repo.stargazers_count;
    totalForks += repo.forks_count;

    const repoLanguages = await github(repo.languages_url.replace(API, ""));

    for (const [language, bytes] of Object.entries(repoLanguages)) {
      languages[language] = (languages[language] || 0) + bytes;
    }
  }

  const username = profile.login;

  const [
    issuesAuthored,
    openIssuesAuthored,
    pullRequestsAuthored,
    mergedPullRequests
  ] = await Promise.all([
    searchCount(`author:${username} type:issue`),
    searchCount(`author:${username} type:issue is:open`),
    searchCount(`author:${username} type:pr`),
    searchCount(`author:${username} type:pr is:merged`)
  ]);

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
      profileUrl: profile.html_url,
      followers: profile.followers,
      following: profile.following
    },

    repositories: {
      public: publicRepos.length,
      private: privateRepos.length,
      total: repositories.length,
      starsReceivedOnPublicRepos: totalStars,
      forksOfPublicRepos: totalForks,
      publicDetails: publicRepositoryDetails
    },

    activity: {
      issuesAuthored,
      openIssuesAuthored,
      pullRequestsAuthored,
      mergedPullRequests
    },

    publicLanguages: Object.entries(languages)
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
  };

  const outputPath = path.join(process.cwd(), "stats.json");

  fs.writeFileSync(
    outputPath,
    JSON.stringify(stats, null, 2) + "\n"
  );

  console.log(`Statistics saved to ${outputPath}`);
  console.log(`Public repositories: ${publicRepos.length}`);
  console.log(`Private repositories: ${privateRepos.length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
