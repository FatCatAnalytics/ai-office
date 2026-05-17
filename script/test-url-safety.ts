// Stage 6.x.1 smoke test for connectors/urlSafety.ts.
// Runs as `tsx script/test-url-safety.ts`. Exits non-zero on first failure.
//
// We can't pull in a real test runner (none in package.json), but this script
// exercises the SSRF guard surface and the SEC name normaliser so regressions
// at least surface in CI on `tsx`.

import { assertSafePublicUrl, classifyIp } from "../server/connectors/urlSafety";
import { normaliseName, stripCorpSuffixes } from "../server/connectors/sec";

interface Case { name: string; got: unknown; want: unknown; }
const cases: Case[] = [];

function expectEq(name: string, got: unknown, want: unknown) {
  cases.push({ name, got, want });
}

(async () => {
  // ── IP classification ────────────────────────────────────────────────────
  expectEq("loopback 127.0.0.1 rejected", classifyIp("127.0.0.1").ok, false);
  expectEq("private 10.0.0.5 rejected",   classifyIp("10.0.0.5").ok, false);
  expectEq("private 192.168.1.1 rejected", classifyIp("192.168.1.1").ok, false);
  expectEq("private 172.20.5.5 rejected",  classifyIp("172.20.5.5").ok, false);
  expectEq("aws metadata rejected",        classifyIp("169.254.169.254").ok, false);
  expectEq("cgnat 100.64.0.1 rejected",    classifyIp("100.64.0.1").ok, false);
  expectEq("multicast 224.0.0.1 rejected", classifyIp("224.0.0.1").ok, false);
  expectEq("public 8.8.8.8 ok",            classifyIp("8.8.8.8").ok, true);
  expectEq("ipv6 ::1 rejected",            classifyIp("::1").ok, false);
  expectEq("ipv6 fc00::1 rejected",        classifyIp("fc00::1").ok, false);
  expectEq("ipv6 fe80::1 rejected",        classifyIp("fe80::1").ok, false);
  expectEq("ipv4-mapped private",          classifyIp("::ffff:10.0.0.1").ok, false);
  expectEq("ipv6 2606:4700::1111 ok",      classifyIp("2606:4700::1111").ok, true);

  // ── URL safety ───────────────────────────────────────────────────────────
  expectEq("ftp scheme rejected",       (await assertSafePublicUrl("ftp://example.com")).ok, false);
  expectEq("file scheme rejected",      (await assertSafePublicUrl("file:///etc/passwd")).ok, false);
  expectEq("javascript: rejected",      (await assertSafePublicUrl("javascript:alert(1)")).ok, false);
  expectEq("creds in URL rejected",     (await assertSafePublicUrl("http://u:p@example.com")).ok, false);
  expectEq("literal 127.0.0.1 rejected", (await assertSafePublicUrl("http://127.0.0.1/")).ok, false);
  expectEq("aws meta literal rejected", (await assertSafePublicUrl("http://169.254.169.254/latest/meta-data/")).ok, false);
  expectEq("ipv6 ::1 literal rejected", (await assertSafePublicUrl("http://[::1]/")).ok, false);
  expectEq("localhost name rejected",   (await assertSafePublicUrl("http://localhost/health")).ok, false);
  expectEq(".local name rejected",      (await assertSafePublicUrl("http://router.local/")).ok, false);
  expectEq(".internal name rejected",   (await assertSafePublicUrl("http://api.internal/")).ok, false);
  expectEq("metadata.google.internal rejected", (await assertSafePublicUrl("http://metadata.google.internal/")).ok, false);

  // ── SEC name normalisation ───────────────────────────────────────────────
  expectEq("normaliseName apple",     normaliseName("Apple Inc."), "apple inc");
  expectEq("stripCorpSuffixes apple", stripCorpSuffixes(normaliseName("Apple Inc.")), "apple");
  expectEq("apple != hospitality",
    normaliseName("Apple Hospitality REIT") === normaliseName("Apple Inc."),
    false);

  // ── Report ───────────────────────────────────────────────────────────────
  let failed = 0;
  for (const c of cases) {
    const ok = c.got === c.want;
    const tag = ok ? "PASS" : "FAIL";
    console.log(`${tag}  ${c.name}  got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
    if (!ok) failed++;
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error("smoke test threw:", e);
  process.exit(1);
});
