# The question your risk dashboard doesn't answer

### Why you probably don't know who you're really lending to.

---

Here's a small exercise. Pick one of your top 20 corporate clients. Now, without looking it up, name the ultimate parent entity. Name five of the subsidiaries you also have exposure to. Name the country where the parent is legally domiciled.

If you're a head of credit or a CFO, you probably got the parent right. Maybe one or two subsidiaries. Probably guessed the domicile. Most people don't get all three.

And the thing is, your risk dashboard almost certainly doesn't either. It *thinks* it does. But if you audit the hierarchy data underneath, you'll find gaps — entities missing from the tree, stale ownership links, duplicates where the same group appears under three different "ultimate parent" labels because the data was entered by three different people over five years.

I want to talk about that gap today, because it's one of the quiet risk issues in mid-market lending and I don't think it gets the attention it deserves.

---

## The problem in one sentence

You know who your counterparty is. You don't always know who they belong to.

A few years ago I was building analytics for a corporate lending book and needed to work out total group-level exposure across a portfolio of around 2,000 legal entities. The first pass used whatever hierarchy data we had in the loan system. The second pass used the GLEIF database — the Global Legal Entity Identifier, which is the open public registry of corporate identifiers and their parent-child relationships.

The difference was embarrassing.

About 8% of the entities in our system had the wrong ultimate parent. About 3% had no parent linked at all. A handful were linked to a parent that had been acquired three years earlier. For a portfolio that size, the amount of exposure effectively sitting in the wrong bucket was not trivial.

This wasn't a unique situation. It's common. The people maintaining counterparty data in loan systems are doing their best, but they're relying on what the client told them at onboarding, which was probably accurate at the time and degrades slowly afterwards.

## Why this matters more than you'd think

The obvious consequence is concentration risk. If you think you have £30m exposure to one group and you actually have £42m, that's a problem on its own. But it gets worse when you zoom out.

Regulatory reporting assumes your hierarchies are right. Stress testing assumes your hierarchies are right. Pricing models that apply group-level discounts or premiums assume your hierarchies are right. If the underlying graph of corporate relationships has a 10% error rate, every downstream calculation inherits that error.

And you probably won't notice, because the errors don't trigger alarms. Nothing breaks. Reports still run. The numbers just aren't quite what they claim to be.

## What actually helps

There's a specific intervention that's surprisingly low-effort and surprisingly high-impact: reconcile your internal hierarchy data against GLEIF, once, properly, and then run a light monthly check after that.

GLEIF is free. The data is public. It covers 2.5 million+ legal entities globally. The API is rate-limited but manageable. A competent analyst can write a script that pulls every LEI in your counterparty master, fetches the current parent chain from GLEIF, and produces a delta report — entities where your system disagrees with GLEIF about who the parent is.

The first run is where the value is. You'll find corrections you should have made years ago. The monthly run after that catches the drift — acquisitions, divestitures, restructurings that you'd otherwise find out about six months late.

I won't pretend it's glamorous. It's exactly the kind of work that nobody wants to own because it doesn't show up on anyone's objectives. But the risk implications are real, and it's cheap compared to almost every other data-quality intervention I've seen banks make.

## The catch worth knowing about

GLEIF isn't perfect either. Coverage is strongest for entities involved in financial transactions that require an LEI (so anything with derivatives exposure, listed debt, or regulatory trading). Coverage is weaker for private mid-market groups that have never had a reason to obtain an LEI. You'll still have gaps for some of your SME clients.

The honest framing is: GLEIF gets you to maybe 85-90% hierarchy accuracy on a typical UK mid-market book, up from whatever you're at now. It's not a panacea. It's a significant improvement.

If you want to go the last mile, you combine GLEIF with Companies House data for UK entities (also free, also underused), which gives you director overlaps and shareholding disclosures that sometimes reveal ownership GLEIF doesn't see.

## The takeaway

This week, ask whoever owns your counterparty data one question:

> *When was the last time we reconciled our parent-subsidiary relationships against an external source?*

If the answer is "never," "I'm not sure," or "we've been meaning to" — you've just identified a weekend of work that will probably pay for itself in one correctly-sized concentration limit. Maybe more.

You don't need a vendor to do this. You don't need a data quality project. You need somebody who can write ~200 lines of Python and a credit officer who can interpret the diff.

---

*The code I wrote for this pulls GLEIF asynchronously so a 2,000-entity portfolio reconciles in about 15 minutes rather than a few hours. If you want to see the pattern, there's a write-up on my GitHub.*

— Aksel

---

**The Analytical Banker** is a weekly note on data, analytics, and AI inside corporate banking — written for finance leaders who actually have to make this stuff work. Reply to this email if something here resonates, or forward it to a colleague who'd benefit.
