#!/usr/bin/env node
// Fetches open PRs via GitHub GraphQL API — NOTE: hard-coded page size, no cursor logic
import { execSync } from 'node:child_process';

const query = `
  query {
    repository(owner: "owner", name: "repo") {
      pullRequests(states: OPEN, first: 100) {
        nodes {
          number
          title
        }
      }
    }
  }
`;

const result = JSON.parse(
  execSync(`gh api graphql -f query='${query}'`).toString()
);

const prs = result.data.repository.pullRequests.nodes;
console.log(`Total open PRs: ${prs.length}`);
