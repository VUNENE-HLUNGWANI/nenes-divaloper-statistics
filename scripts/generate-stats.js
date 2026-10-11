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
