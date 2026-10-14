/**
 * Uploads the card images in public/cards/small/ to the Cloudflare R2 bucket the site serves them
 * from, keeping the same paths (small/<passcode>.jpg).
 *
 *   pnpm cards:upload --dry-run      show what would be uploaded, without uploading anything
 *   pnpm cards:upload --limit 3      upload just a few, to check the bucket and the keys
 *   pnpm cards:upload                upload every image the bucket does not have yet
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET in .env. Images already
 * in the bucket at the same size are skipped, so the job can be stopped and run again, and after a
 * new set it only uploads the new cards.
 *
 * R2 speaks Amazon S3's protocol, so requests are signed the S3 way (Signature Version 4); this does
 * it with Node's own crypto rather than pulling in an AWS SDK for two kinds of request.
 */
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CARD_IMAGES_DIR, ENV_PATH } from "./paths.ts";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    concurrency: { type: "string", default: "24" },
  },
});

if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const env = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. Copy the R2 lines from .env.example into .env and fill them in.`);
    process.exit(1);
  }
  return value;
};
const account = env("R2_ACCOUNT_ID");
const accessKey = env("R2_ACCESS_KEY_ID");
const secretKey = env("R2_SECRET_ACCESS_KEY");
const bucket = env("R2_BUCKET");

const HOST = `${account}.r2.cloudflarestorage.com`;
const PREFIX = "small/";
/** The same caching the site asks for when it serves the images itself (see next.config.ts). */
const CACHE_CONTROL = "public, max-age=2592000, stale-while-revalidate=86400";
const ATTEMPTS = 4;

// --- Signing ------------------------------------------------------------------------------------

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
/** S3 wants RFC 3986 encoding, which also escapes the characters encodeURIComponent leaves alone. */
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signs a request to the bucket and sends it. `key` is the object's path within the bucket. */
async function send(method: "GET" | "PUT" | "HEAD", key: string, { query = {}, body, headers = {} }: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> } = {}) {
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = now.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const canonicalPath = `/${encode(bucket)}/${key.split("/").map(encode).join("/")}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encode(name)}=${encode(query[name]!)}`)
    .join("&");
  const signed: Record<string, string> = { host: HOST, "x-amz-content-sha256": payloadHash, "x-amz-date": now };
  for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = value.trim();
  const names = Object.keys(signed).sort();
  const canonicalRequest = [method, canonicalPath, canonicalQuery, names.map((name) => `${name}:${signed[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = ["auto", "s3", "aws4_request"].reduce((key, part) => hmac(key, part), hmac(`AWS4${secretKey}`, day));
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");

  const { host: _host, ...sent } = signed;
  return fetch(`https://${HOST}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
    method,
    body: body ? new Uint8Array(body) : undefined,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
  });
}

/** Explains a refused request in terms of what to check, rather than as an XML error document. */
async function refused(response: Response, doing: string): Promise<never> {
  const detail = (await response.text()).match(/<Code>([^<]*)<\/Code>/)?.[1] ?? response.statusText;
  const hint =
    response.status === 403
      ? "The keys were refused. Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, and that the token has Object Read & Write on this bucket."
      : response.status === 404
        ? `No bucket called "${bucket}" in this account. Check R2_BUCKET and R2_ACCOUNT_ID.`
        : "";
  console.error(`R2 refused ${doing} (${response.status} ${detail}). ${hint}`);
  process.exit(1);
}

// --- What is there already ----------------------------------------------------------------------

/** Every image already in the bucket, by key, with its size. */
async function listUploaded(): Promise<Map<string, number>> {
  const uploaded = new Map<string, number>();
  let token: string | undefined;
  do {
    const response = await send("GET", "", { query: { "list-type": "2", prefix: PREFIX, "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) } });
    if (!response.ok) await refused(response, "the request to list the bucket");
    const xml = await response.text();
    for (const [, key, size] of xml.matchAll(/<Key>([^<]*)<\/Key>(?:(?!<\/Contents>)[\s\S])*?<Size>(\d+)<\/Size>/g)) uploaded.set(key!, Number(size));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] : undefined;
  } while (token);
  return uploaded;
}

// --- Uploading ----------------------------------------------------------------------------------

const folder = path.join(CARD_IMAGES_DIR, "small");
if (!fs.existsSync(folder)) {
  console.error(`No images in ${folder}. Run "pnpm cards:images" first.`);
  process.exit(1);
}

const files = fs
  .readdirSync(folder)
  .filter((name) => name.endsWith(".jpg"))
  .map((name) => ({ name, key: PREFIX + name, size: fs.statSync(path.join(folder, name)).size }));

console.log(`${files.length} images in ${path.relative(process.cwd(), folder)}. Checking what bucket "${bucket}" already has...`);
const uploaded = await listUploaded();
let todo = files.filter(({ key, size }) => uploaded.get(key) !== size);
if (args.limit) todo = todo.slice(0, Number(args.limit));
const bytes = todo.reduce((sum, { size }) => sum + size, 0);
console.log(`${uploaded.size} already uploaded; ${todo.length} to upload (${(bytes / 1e6).toFixed(1)} MB).`);

if (args["dry-run"] || todo.length === 0) process.exit(0);

let done = 0;
let failed: string[] = [];
const started = Date.now();
let next = 0;

async function upload({ name, key }: (typeof files)[number]) {
  const body = fs.readFileSync(path.join(folder, name));
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await send("PUT", key, { body, headers: { "content-type": "image/jpeg", "cache-control": CACHE_CONTROL } });
      if (response.ok) return true;
      if (response.status === 403 || response.status === 404) await refused(response, `the upload of ${key}`);
    } catch {
      // A dropped connection is worth another try, like an overloaded server.
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  return false;
}

await Promise.all(
  Array.from({ length: Number(args.concurrency) }, async () => {
    while (next < todo.length) {
      const file = todo[next++]!;
      if (!(await upload(file))) failed.push(file.key);
      if (++done % 500 === 0 || done === todo.length) {
        const seconds = (Date.now() - started) / 1000;
        console.log(`  ${done}/${todo.length} (${(done / seconds).toFixed(0)} a second)`);
      }
    }
  }),
);

console.log(`\nUploaded ${done - failed.length} images in ${((Date.now() - started) / 1000).toFixed(0)} s${failed.length ? `; ${failed.length} failed and will be retried on the next run` : ""}.`);
