import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type HostLookup = (hostname: string) => Promise<string[]>;

const systemLookup: HostLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export async function assertPublicHttpUrl(
  rawUrl: string,
  lookup: HostLookup = systemLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL must be valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("URL must not contain credentials");
  }
  if (!url.hostname) throw new Error("URL must include a hostname");

  const addresses = isIP(url.hostname) ? [url.hostname] : await lookup(url.hostname);
  if (addresses.length === 0) throw new Error("URL hostname did not resolve");
  if (addresses.some(isPrivateAddress)) {
    throw new Error("URL resolves to a private network address");
  }
  return url;
}

export async function assertSameOriginTarget(
  storeUrl: string,
  targetProductUrl: string,
  lookup: HostLookup = systemLookup,
): Promise<{ store: URL; target: URL }> {
  const [store, target] = await Promise.all([
    assertPublicHttpUrl(storeUrl, lookup),
    assertPublicHttpUrl(targetProductUrl, lookup),
  ]);
  if (store.origin !== target.origin) {
    throw new Error("target product must use the store origin");
  }
  return { store, target };
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    return isPrivateAddress(normalized.slice("::ffff:".length));
  }
  if (isIP(normalized) !== 4) return false;
  const [a = 0, b = 0] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}
