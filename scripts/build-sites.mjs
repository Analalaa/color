import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(projectRoot, "dist");
const clientRoot = join(outputRoot, "client");
const serverRoot = join(outputRoot, "server");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(clientRoot, { recursive: true });
await mkdir(serverRoot, { recursive: true });

for (const entry of ["index.html", "favicon.ico", "favicon_small.ico", "css", "js", "assets"]) {
  await cp(join(projectRoot, entry), join(clientRoot, entry), { recursive: true });
}

const worker = `const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    if (response.status !== 404 || request.method !== "GET") {
      return response;
    }

    const fallback = new URL("/index.html", request.url);
    return env.ASSETS.fetch(new Request(fallback, request));
  },
};

export default worker;
`;

await writeFile(join(serverRoot, "index.js"), worker, "utf8");

console.log(`Sites build ready at ${outputRoot}`);
