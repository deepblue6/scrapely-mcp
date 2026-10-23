// `scrapely enrich profile` against the local mock API: free lookup, no confirmation, handle sent as a query param.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GOOD_KEY, startMockApi } from "./helpers/mock-api.js";
import { runCli } from "./helpers/run-cli.js";

// Response shape copied from pages/api/v1/enrich/profile.js in the app repo.
const PROFILE = {
  handle: "AlexHormozi",
  user_id: "1417686048579018753",
  name: "Alex Hormozi",
  bio: "Co-Founder: https://acquisition.com/",
  bio_urls: ["https://acquisition.com/"],
  profile_url: "https://x.com/AlexHormozi",
  profile_image_url: "https://pbs.twimg.com/profile_images/1/a_400x400.jpg",
  followers_count: 1082680,
  following_count: 195,
  verified: true,
  location: null,
};

let api;
before(async () => {
  api = await startMockApi({ "GET /enrich/profile": PROFILE });
});
after(() => api.close());

const cli = (args) => runCli(args, { base: api.base, env: { SCRAPELY_API_KEY: GOOD_KEY, COLUMNS: "80" } });

test("enrich profile sends GET /enrich/profile?handle= without asking first", async () => {
  const { code, stdout } = await cli(["enrich", "profile", "--handle", "@AlexHormozi", "--json"]);
  assert.equal(code, 0);
  const sent = api.requests.filter((r) => r.method === "GET" && r.path === "/enrich/profile");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].query.handle, "@AlexHormozi");
  assert.deepEqual(JSON.parse(stdout), PROFILE);
});
