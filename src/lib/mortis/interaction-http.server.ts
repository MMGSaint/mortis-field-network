import { MortisRuntime } from "./runtime";

const g = globalThis as typeof globalThis & { __mortisRuntime?: Promise<MortisRuntime> };

async function runtime(): Promise<MortisRuntime> {
  if (!g.__mortisRuntime) {
    g.__mortisRuntime = (async () => {
      const rt = MortisRuntime.load(process.cwd());
      await rt.bootstrapKeys();
      rt.seedOwner("owner_1", "owner");
      rt.seedOperations("ops_1", "ops");
      return rt;
    })();
  }
  return g.__mortisRuntime;
}

export async function handleDiscordInteractionPost(request: Request): Promise<Response> {
  const rt = await runtime();
  const url = new URL(request.url);
  url.pathname = "/interactions";
  return rt.fetch(new Request(url.toString(), request));
}
