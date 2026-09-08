import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BusinessExampleSwitcher } from "./business-example-switcher";

const route = "/guides/what-software-does-my-small-business-need";
const pageTitle = "What Software Does Your Small Business Actually Need?";
const pageDescription =
  "A practical guide to choosing between a CRM, specialist software, flexible tools and a connected workspace built around how your business works.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: route },
  openGraph: {
    title: `${pageTitle} · Lenni`,
    description: pageDescription,
    type: "article",
    url: route,
    images: ["/og-lenni.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${pageTitle} · Lenni`,
    description: pageDescription,
    images: ["/og-lenni.png"],
  },
};

const guideJsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: pageTitle,
  description: pageDescription,
  author: { "@type": "Organization", name: "Lenni" },
  publisher: { "@type": "Organization", name: "Lenni" },
  mainEntityOfPage: `https://uselenni.com${route}`,
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Do I need a CRM for my small business?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A CRM is often enough when customer and sales activity is the main problem. If the business also needs to connect jobs, orders, appointments, equipment or other operational work, map those needs before choosing a CRM.",
      },
    },
    {
      "@type": "Question",
      name: "When is a spreadsheet still enough for a small business?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A spreadsheet can remain a good fit when one person can keep it current, the relationships stay simple and important next steps are not being lost.",
      },
    },
    {
      "@type": "Question",
      name: "What does all-in-one small-business software mean?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It should not mean every feature imaginable. It should mean one dependable place for the information and operating views that genuinely belong together in that business.",
      },
    },
  ],
};

const foundations = [
  {
    number: "01",
    title: "People",
    text: "Customers, suppliers, staff or partners you need to remember.",
  },
  {
    number: "02",
    title: "Work",
    text: "Jobs, orders, appointments, enquiries or recurring visits.",
  },
  {
    number: "03",
    title: "Connections",
    text: "Which customer owns the job; which quote belongs to it; what comes next.",
  },
  {
    number: "04",
    title: "Useful views",
    text: "What is due today, waiting for reply, ready to collect or still open.",
  },
];

const choices = [
  {
    question: "Mostly a sales pipeline?",
    title: "A simple CRM may be enough.",
    text: "Best when contacts, deals and follow-ups are the centre of the business.",
  },
  {
    question: "One repeated operating process?",
    title: "Specialist software may fit best.",
    text: "Useful when the business closely matches a proven workflow such as booking or field service.",
  },
  {
    question: "Happy designing the system yourself?",
    title: "A flexible DIY tool can work well.",
    text: "Strong when somebody has the time and confidence to build and maintain the setup.",
  },
  {
    question: "Customers, work and business-specific information?",
    title: "Consider a flexible operating workspace.",
    text: "Useful when several connected parts need one home, but you do not want to become the software builder.",
    lenni: true,
  },
];

export default function SoftwareGuidePage(): ReactNode {
  return (
    <main id="main" className="software-guide" tabIndex={-1}>
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([guideJsonLd, faqJsonLd]).replaceAll(
            "<",
            "\\u003c",
          ),
        }}
        type="application/ld+json"
      />

      <section className="software-guide-hero" aria-labelledby="guide-title">
        <div className="software-guide-hero-copy">
          <p className="marketing-kicker">
            A practical guide for small-business owners
          </p>
          <h1 id="guide-title">
            What software does your small business <span>actually need?</span>
          </h1>
          <p className="software-guide-lede">
            CRM, job-management software, a project tool, several specialist
            apps—or something built around the way your business already works?
          </p>
          <Link className="marketing-button" href="#start-with-the-work">
            Work it out step by step <span aria-hidden="true">↓</span>
          </Link>
          <p className="software-guide-note">
            No software jargon. Start with the work you need to run.
          </p>
        </div>

        <aside className="software-guide-answer" aria-label="The short answer">
          <span>The short answer</span>
          <strong>Start with the business, not the software category.</strong>
          <p>
            List what you need to keep track of, how those things connect, and
            what your team needs to see. The right software should fit that
            shape—not force every part of the business into one generic
            pipeline.
          </p>
        </aside>
      </section>

      <section
        className="software-guide-section"
        id="start-with-the-work"
        aria-labelledby="four-parts-title"
      >
        <div className="software-guide-section-inner">
          <div className="software-guide-section-heading">
            <p className="marketing-kicker">Before comparing products</p>
            <h2 id="four-parts-title">Describe the work in four parts.</h2>
            <p>
              This turns a vague software search into a useful brief—whether you
              eventually choose a CRM, a specialist tool or a more flexible
              workspace.
            </p>
          </div>
          <div className="software-guide-foundations">
            {foundations.map((foundation) => (
              <article key={foundation.number}>
                <span>{foundation.number}</span>
                <h3>{foundation.title}</h3>
                <p>{foundation.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="software-guide-section software-guide-section-quiet"
        aria-labelledby="business-shape-title"
      >
        <div className="software-guide-section-inner">
          <div className="software-guide-section-heading">
            <p className="marketing-kicker">The shape changes by business</p>
            <h2 id="business-shape-title">
              “Customer management” rarely means only customers.
            </h2>
            <p>
              Choose an example to see why the right system depends on how the
              work fits together.
            </p>
          </div>
          <BusinessExampleSwitcher />
        </div>
      </section>

      <section
        className="software-guide-section"
        aria-labelledby="decision-guide-title"
      >
        <div className="software-guide-section-inner">
          <div className="software-guide-section-heading">
            <p className="marketing-kicker">A simple decision guide</p>
            <h2 id="decision-guide-title">
              Choose for the problem you actually have.
            </h2>
          </div>
          <div className="software-guide-choices">
            {choices.map((choice) => (
              <article
                className={choice.lenni ? "software-guide-choice-lenni" : ""}
                key={choice.question}
              >
                <span>{choice.question}</span>
                <h3>{choice.title}</h3>
                <p>{choice.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="software-guide-section software-guide-section-quiet"
        aria-labelledby="lenni-fit-title"
      >
        <div className="software-guide-section-inner">
          <div className="software-guide-section-heading">
            <p className="marketing-kicker">Where Lenni fits</p>
            <h2 id="lenni-fit-title">
              Describe the business. See the workspace before you commit.
            </h2>
            <p>
              Lenni turns an ordinary description into a reviewable starting
              point, then the day-to-day work runs through normal Tables and
              Pages.
            </p>
          </div>

          <div className="software-guide-product-proof">
            <div className="software-guide-prompt">
              <div>
                <span>Tell Lenni what you need</span>
                <blockquote>
                  “We run a small maintenance company. I need one place for
                  customers, jobs and quotes, including what is waiting for a
                  reply.”
                </blockquote>
              </div>
              <small>A few sentences. No technical brief.</small>
            </div>

            <div
              className="software-guide-workspace"
              aria-label="An example Lenni workspace showing quotes waiting for reply"
            >
              <div className="software-guide-workspace-bar">
                <span>Lenni workspace</span>
                <span>Proposed setup · ready to review</span>
              </div>
              <div className="software-guide-workspace-body">
                <aside aria-hidden="true">
                  <strong>Whitfield Maintenance</strong>
                  <span>Home</span>
                  <span>Customers</span>
                  <span>Jobs</span>
                  <span className="software-guide-workspace-active">
                    Quotes
                  </span>
                  <span>Pages</span>
                </aside>
                <div className="software-guide-workspace-main">
                  <h3>Quotes</h3>
                  <p>Waiting for reply · 3</p>
                  <div className="software-guide-table" role="presentation">
                    <div className="software-guide-table-row software-guide-table-head">
                      <span>Quote</span>
                      <span>Customer</span>
                      <span>Status</span>
                    </div>
                    <div className="software-guide-table-row">
                      <span>Second-site quote</span>
                      <span>R. Whitfield</span>
                      <span className="software-guide-status">Waiting</span>
                    </div>
                    <div className="software-guide-table-row">
                      <span>Annual service</span>
                      <span>Merrow Hall</span>
                      <span className="software-guide-status">Waiting</span>
                    </div>
                    <div className="software-guide-table-row">
                      <span>Boiler replacement</span>
                      <span>North &amp; Co.</span>
                      <span className="software-guide-status">Waiting</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="software-guide-section"
        aria-labelledby="guide-questions-title"
      >
        <div className="software-guide-section-inner">
          <div className="software-guide-section-heading">
            <p className="marketing-kicker">Common questions</p>
            <h2 id="guide-questions-title">
              Useful answers, without the software sales pitch.
            </h2>
          </div>
          <div className="software-guide-faq">
            <article>
              <h3>Do I need a CRM for my small business?</h3>
              <p>
                Only if customer and sales activity is the main problem. If you
                also need jobs, orders, visits or equipment, map those first.
              </p>
            </article>
            <article>
              <h3>When is a spreadsheet still enough?</h3>
              <p>
                When one person can keep it current, the relationships stay
                simple and important next steps are not being lost.
              </p>
            </article>
            <article>
              <h3>What does “all in one” really mean?</h3>
              <p>
                Not every feature imaginable—just one dependable place for the
                information and operating views that genuinely belong together.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section
        className="software-guide-closing"
        aria-labelledby="software-guide-closing-title"
      >
        <h2 id="software-guide-closing-title">
          You do not need to know what category of software to buy.
        </h2>
        <p>
          Describe how the business works and what is becoming difficult. Join
          early access to see what a connected Lenni workspace could look like
          for your business.
        </p>
        <Link className="marketing-button" href="/#early-access">
          Show me what Lenni would build
        </Link>
      </section>
    </main>
  );
}
