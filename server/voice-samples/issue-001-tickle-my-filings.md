# Welcome to The Analytical Banker

### Issue #001 — The 10-K hack I keep reaching for, and what it tells you about your own reporting stack.

---

A quick word before we begin, since this is the first one.

I've spent most of my career inside corporate banks, building and leading analytics teams. The work I cared about most was never the headline AI project — it was the unglamorous middle ground. The forecasting model that actually changed a risk decision. The dashboard that replaced 1,500 hours of manual reporting. The script somebody wrote in a weekend that quietly saved a team from buying a £200k tool they didn't need.

That middle ground is what this newsletter is about.

The goal is simple: one short note a week, written for finance leaders who actually have to make this stuff work. No vendor plugs. No breathless takes on whatever model launched on Twitter this morning. Just practical notes on data, analytics, and AI — the kind of thing I'd send to a friend running a finance function who asked me *"what should I actually be doing about this?"*

If that sounds useful, stick around. If not, the unsubscribe link always works and I won't take it personally.

Here's the first one.

— Aksel

---

## The 10-K hack I keep reaching for

A few years ago I was trying to answer what looked like a simple question.

A senior colleague wanted to know which of a hundred companies in a portfolio were actively hedging their FX exposure, and what kind. Straightforward, right? It's all in the 10-K. Every filer discloses it. It's publicly available on EDGAR. Free.

So I did what anyone would do: I went looking for a Python library that would let me search SEC filings for specific disclosures and pull the surrounding text. There are plenty of libraries for parsing 10-Ks. Every single one of them was built to extract financial statements. Revenue, EBITDA, balance sheet line items. None of them did what I actually wanted, which was to say *"show me every text block that mentions hedging, across these 100 companies, in their most recent filings."*

I spent about a day looking. Then I wrote my own in a weekend. I called it TickleMyFilings. It's about 300 lines of Python. It's ugly. It works.

The thing I want to talk about today isn't the code. It's the question I *should* have been asking before I started looking for a library in the first place.

---

### The wrong default

In financial services we have a default setting — and I include myself in this — that goes: *if a problem requires software, we buy software.*

The instinct is understandable. Most of us have been burned by build-it-yourself projects that ate six months, produced something barely functional, and created a permanent maintenance headache when the analyst who wrote it left. So we've trained ourselves to reach for a vendor.

But here's the problem: the vendor default assumes two things that are often wrong.

The first is that **your problem is big enough to warrant a product.** A lot of analytics problems in finance aren't "we need a platform." They're "we need an answer, once, to a specific question." The hedging survey I mentioned? Nobody was going to run that again for two years. Buying a filings-parsing SaaS for it would have been absurd.

The second is that **somebody else has already solved this exact problem.** Often they haven't. Vendors build for the 80% use case. If you're in the 20% — and in finance you usually are, because every bank, every lender, every fund has its own quirks — the vendor tool fits awkwardly. You end up paying six figures for something that does 70% of what you need and then spending internal time on the other 30% anyway.

### The question I wish I'd asked first

Before you buy a tool, there's a diagnostic question worth running:

> *If I had a competent person sit with the data for a weekend, could they answer this once?*

If yes, you probably don't have a product problem. You have an information problem, and the solution is somebody writing a script, running it, handing you the answer, and throwing the script away.

Some examples of things that look product-shaped but are actually weekend-shaped:

**"We need to monitor counterparty exposure changes across our top 50 clients."** This is often a weekend script that pulls filings, flags changes from the prior period, and emails you a diff. Not a platform.

**"We need to benchmark our pricing against the market."** Depending on the data source, this is sometimes a few hundred lines of Python plus a dashboard. Not a BI implementation.

**"We need to categorise our corporate loan book by sector exposure."** If you already have the raw data, this is a classification exercise, not a data warehouse redesign.

I've seen banks spend £200k+ on each of those problems. I've also seen them solved for the cost of one person's week. The difference was usually whether anyone stopped to ask the diagnostic question first.

### When buying is right

I'm not making the case that you should always build. There are plenty of problems where buying is obviously correct. If you need something that's going to be used every day, by a lot of people, forever — buy. If the vendor has access to proprietary data you can't easily get — buy. If the total cost of building and maintaining a decent internal tool exceeds the licence fee — buy.

The rule I try to follow: **buy for the things that scale, build for the things that don't.**

A treasury management system is a scale thing — you'll use it for a decade, the vendor has regulatory integrations you don't want to rebuild, the economics work. A script that answers *"which of my clients are hedging FX and how much?"* is a one-off thing. The economics are reversed.

Most analytics teams I see have this backwards. They buy too many point tools for one-off problems, and they build too little of their own quick infrastructure because it feels scary.

### The takeaway

This week, look at your analytics budget and find a line item that's under £50k annually. Ask yourself two questions about it:

1. Do we use this tool every day, or a few times a year?
2. If the answer is "a few times a year" — could we have solved the underlying problem with a script instead?

You won't always like the answer. But you'll find at least one line item where the honest answer is *we bought this because it felt safer than asking someone to just write it.* That's the money you can redirect to something that actually moves the needle.

---

*If you want to see what the "weekend script" version of SEC filings parsing actually looks like, the code for TickleMyFilings is on my GitHub. It's not pretty. That's the point.*

— Aksel

---

**The Analytical Banker** is a weekly note on data, analytics, and AI inside corporate banking — written for finance leaders who actually have to make this stuff work. Reply to this email if something here resonates, or forward it to a colleague who'd benefit.

*You're reading because you subscribed at fatcatanalytics.co.uk. If this isn't for you, the unsubscribe link is at the bottom and I won't take it personally.*
