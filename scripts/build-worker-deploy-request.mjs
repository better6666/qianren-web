import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
const deploymentCode = `async () => {
  const source = ${JSON.stringify(source)};
  const metadata = { main_module: "worker.js", compatibility_date: "2026-08-15", bindings: [] };
  const boundary = "----qianren-worker-" + Date.now();
  const body = [
    "--" + boundary,
    "Content-Disposition: form-data; name=\\"metadata\\"",
    "Content-Type: application/json",
    "",
    JSON.stringify(metadata),
    "--" + boundary,
    "Content-Disposition: form-data; name=\\"worker.js\\"; filename=\\"worker.js\\"",
    "Content-Type: application/javascript+module",
    "",
    source,
    "--" + boundary + "--"
  ].join("\\r\\n");
  return cloudflare.request({
    method: "PUT",
    path: "/accounts/" + accountId + "/workers/scripts/qianren-api",
    body,
    contentType: "multipart/form-data; boundary=" + boundary,
    rawBody: true
  });
}`;

writeFileSync("/tmp/qianren-worker-deploy.json", JSON.stringify({
  account_id: "783b2b0c30e5156033cb098a51faf66c",
  code: deploymentCode,
}));
