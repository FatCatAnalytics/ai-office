// Stage 6.x.1: SSRF guardrails for any URL we hand to fetch().
//
// We reject:
//   - non-http(s) schemes
//   - userinfo in the URL (e.g. http://user:pass@host)
//   - localhost/loopback hostnames
//   - private IPv4 ranges (RFC1918), link-local 169.254/16 (includes 169.254.169.254
//     cloud metadata), CGNAT 100.64/10, multicast 224/4, reserved 240/4, 0.0.0.0/8
//   - IPv6 loopback ::1, unique-local fc00::/7, link-local fe80::/10, IPv4-mapped
//     forms of the above, and the AWS-IMDSv2 dual-stack metadata address
//     fd00:ec2::254
//   - hosts that look like cloud metadata services (metadata.google.internal,
//     metadata.aws.internal, etc.)
//
// After DNS resolution, we also reject if any A/AAAA record falls into the
// private space above. This protects against DNS-rebinding-style attacks where
// a hostname resolves to a public IP at validation time and a private IP at
// fetch time — we resolve once and then connect directly to the resolved
// public address (see safeFetch in http.ts).

import dns from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set<string>([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "metadata.aws.internal",
  "metadata.azure.com",
  "metadata.packet.net",
  "instance-data",
  "instance-data.ec2.internal",
]);

const SUSPICIOUS_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".intranet",
  ".corp",
  ".lan",
  ".home.arpa",
];

export type UrlSafetyResult =
  | { ok: true; url: URL; resolvedIp: string }
  | { ok: false; reason: string };

export interface UrlSafetyOptions {
  /** Allow these private hostnames anyway. For tests only. */
  allowHosts?: string[];
}

/**
 * Validate that `input` is a public http(s) URL safe to fetch.
 * Resolves DNS and confirms no resolved address is private/reserved.
 * Returns the parsed URL and the resolved IP so the caller can dial directly
 * (avoiding DNS rebinding between validation and connection).
 */
export async function assertSafePublicUrl(
  input: string,
  opts: UrlSafetyOptions = {},
): Promise<UrlSafetyResult> {
  let url: URL;
  try { url = new URL(input); }
  catch { return { ok: false, reason: "Invalid URL" }; }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Disallowed URL scheme: ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "Missing hostname" };

  const allowSet = new Set((opts.allowHosts ?? []).map((s) => s.toLowerCase()));
  if (allowSet.has(host)) {
    return { ok: true, url, resolvedIp: host };
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: `Blocked hostname: ${host}` };
  }
  for (const sfx of SUSPICIOUS_SUFFIXES) {
    if (host === sfx.slice(1) || host.endsWith(sfx)) {
      return { ok: false, reason: `Suspicious hostname suffix: ${host}` };
    }
  }

  // Literal IP in the URL — validate directly without DNS.
  if (isIpLiteral(host)) {
    const verdict = classifyIp(host);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    return { ok: true, url, resolvedIp: verdict.address };
  }

  // Resolve and reject if any address is private/reserved.
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: false });
  } catch (e) {
    return { ok: false, reason: `DNS resolution failed for ${host}` };
  }
  if (addrs.length === 0) return { ok: false, reason: `No DNS records for ${host}` };

  for (const a of addrs) {
    const verdict = classifyIp(a.address);
    if (!verdict.ok) return { ok: false, reason: `Resolved address ${a.address} is not allowed (${verdict.reason})` };
  }
  return { ok: true, url, resolvedIp: addrs[0].address };
}

function isIpLiteral(host: string): boolean {
  return isIPv4(host) || isIPv6(host);
}

function isIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isIPv6(host: string): boolean {
  return host.includes(":");
}

type IpVerdict = { ok: true; address: string } | { ok: false; reason: string };

export function classifyIp(addr: string): IpVerdict {
  // Strip zone-id, brackets already removed.
  const a = addr.split("%")[0];
  if (isIPv4(a)) return classifyIPv4(a);
  if (isIPv6(a)) return classifyIPv6(a);
  return { ok: false, reason: "Unrecognised address" };
}

function classifyIPv4(a: string): IpVerdict {
  const parts = a.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return { ok: false, reason: "Invalid IPv4" };
  }
  const [o1, o2] = parts;
  // 0.0.0.0/8
  if (o1 === 0) return { ok: false, reason: "wildcard/zero network" };
  // 10.0.0.0/8
  if (o1 === 10) return { ok: false, reason: "private (10/8)" };
  // 127.0.0.0/8 loopback
  if (o1 === 127) return { ok: false, reason: "loopback" };
  // 169.254.0.0/16 link-local (also AWS/GCP metadata 169.254.169.254)
  if (o1 === 169 && o2 === 254) return { ok: false, reason: "link-local/metadata" };
  // 172.16.0.0/12
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return { ok: false, reason: "private (172.16/12)" };
  // 192.0.0.0/24 IETF protocol assignments, 192.0.2.0/24 TEST-NET-1
  if (o1 === 192 && o2 === 0) return { ok: false, reason: "reserved 192.0.0/24" };
  // 192.168.0.0/16
  if (o1 === 192 && o2 === 168) return { ok: false, reason: "private (192.168/16)" };
  // 198.18.0.0/15 benchmark
  if (o1 === 198 && (o2 === 18 || o2 === 19)) return { ok: false, reason: "benchmarking" };
  // 198.51.100.0/24 TEST-NET-2, 203.0.113.0/24 TEST-NET-3
  if (o1 === 198 && o2 === 51 && parts[2] === 100) return { ok: false, reason: "TEST-NET" };
  if (o1 === 203 && o2 === 0 && parts[2] === 113) return { ok: false, reason: "TEST-NET" };
  // 100.64.0.0/10 CGNAT
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return { ok: false, reason: "CGNAT (100.64/10)" };
  // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved
  if (o1 >= 224) return { ok: false, reason: "multicast/reserved" };
  // 255.255.255.255 broadcast already caught by >=240.
  return { ok: true, address: a };
}

function classifyIPv6(addrIn: string): IpVerdict {
  const lower = addrIn.toLowerCase();
  // Loopback ::1
  if (lower === "::1") return { ok: false, reason: "IPv6 loopback" };
  // Unspecified ::
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return { ok: false, reason: "IPv6 unspecified" };
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return { ok: false, reason: "IPv6 link-local" };
  // Unique local fc00::/7 (fc.. or fd..)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return { ok: false, reason: "IPv6 ULA (private)" };
  // Multicast ff00::/8
  if (lower.startsWith("ff")) return { ok: false, reason: "IPv6 multicast" };
  // Discard prefix 100::/64
  if (/^100:0:0:0:/.test(lower) || lower === "100::") return { ok: false, reason: "IPv6 discard" };
  // IPv4-mapped ::ffff:a.b.c.d — classify the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return classifyIPv4(mapped[1]);
  // IPv4-compatible ::a.b.c.d
  const compat = lower.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (compat) return classifyIPv4(compat[1]);
  // Specific AWS metadata IPv6: fd00:ec2::254
  if (lower === "fd00:ec2::254") return { ok: false, reason: "AWS metadata IPv6" };
  return { ok: true, address: addrIn };
}
