import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

const pageTitle = "Your business has outgrown spreadsheets. What comes next?";
const pageDescription =
  "A practical way to move from spreadsheets, messages and memory to a connected, editable business workspace.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "/outgrown-spreadsheets",
  },
  openGraph: {
    title: `${pageTitle} · Lenni`,
    description: pageDescription,
    type: "article",
    url: "/outgrown-spreadsheets",
    images: ["/og-lenni.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${pageTitle} · Lenni`,
    description: pageDescription,
    images: ["/og-lenni.png"],
  },
};

function EarlyAccessLink({ className }: { className?: string }): ReactNode {
  return (
    <Link className={className} href="/#early-access">
      Show me what Lenni would build
    </Link>
  );
}

export default function OutgrownSpreadsheetsPage(): ReactNode {
  return (
    <main className="marketing-article">
      <section
        className="marketing-article-hero"
        aria-labelledby="article-title"
      >
        <p className="marketing-kicker">A calmer next step</p>
        <h1 id="article-title">{pageTitle}</h1>
        <p className="marketing-article-lede">
          Most small businesses do not outgrow spreadsheets because spreadsheets
          are bad. They outgrow the point where one spreadsheet can stay the
          organising system for all the work now connected around it.
        </p>
        <EarlyAccessLink className="marketing-button" />
        <p className="marketing-article-reassurance">
          Join the early-access list to see Lenni when it&apos;s ready. No
          account is created today.
        </p>
      </section>

      <section
        className="marketing-article-section"
        aria-labelledby="system-title"
      >
        <div className="marketing-article-section-heading">
          <p className="marketing-kicker">The real problem</p>
          <h2 id="system-title">Eventually, you are the system.</h2>
        </div>
        <div className="marketing-article-copy">
          <p>
            A spreadsheet starts to carry more than rows. Messages contain the
            latest update. The inbox holds a promise to follow up. A process
            lives in someone&apos;s memory. The work becomes spread across a
            spreadsheet, messages, inboxes, memory and disconnected processes.
          </p>
          <p>That can leave the owner responsible for remembering:</p>
          <ul className="marketing-article-list">
            <li>what needs following up;</li>
            <li>which row relates to which customer;</li>
            <li>what changed;</li>
            <li>where the latest information lives; and</li>
            <li>what somebody else needs to know.</li>
          </ul>
        </div>
      </section>

      <section
        className="marketing-article-section marketing-article-section-quiet"
        aria-labelledby="business-first-title"
      >
        <div className="marketing-article-section-heading">
          <p className="marketing-kicker">The decision</p>
          <h2 id="business-first-title">
            Don&apos;t choose the software first. Start with the business.
          </h2>
        </div>
        <div className="marketing-article-copy">
          <p>
            The first question is not “Which CRM, project manager or database
            should I buy?” It is what your business actually needs to keep track
            of, how that information connects, and how you need to work with it.
          </p>
          <p>
            Once those answers are clear, the software has a job to do: give the
            work a shared, understandable place without forcing the business
            into somebody else&apos;s process.
          </p>
        </div>
      </section>

      <section
        className="marketing-article-section"
        aria-labelledby="connected-title"
      >
        <div className="marketing-article-section-heading">
          <p className="marketing-kicker">Connected information</p>
          <h2 id="connected-title">Make the relationships visible.</h2>
        </div>
        <div className="marketing-article-copy">
          <p>
            In one business, the useful starting point might be a connected path
            from Customer to Job to Quote. In another, it will be something
            entirely different. The important part is that the information can
            stay connected as the work changes.
          </p>
          <div
            className="marketing-connection-example"
            aria-label="Customer leads to Job, which leads to Quote"
          >
            <span>Customer</span>
            <span aria-hidden="true">→</span>
            <span>Job</span>
            <span aria-hidden="true">→</span>
            <span>Quote</span>
          </div>
          <p>
            Views then give the team useful ways to look at the same
            information: jobs to follow up, open enquiries, this week&apos;s
            work, or customers waiting on a quote. They are simply useful
            perspectives on work already recorded, not promises of automatic
            action.
          </p>
        </div>
      </section>

      <section
        className="marketing-article-section marketing-article-section-quiet"
        aria-labelledby="progression-title"
      >
        <div className="marketing-article-section-heading">
          <p className="marketing-kicker">How Lenni fits</p>
          <h2 id="progression-title">
            A starting workspace you can understand and edit.
          </h2>
        </div>
        <ol className="marketing-progression">
          <li>Describe the business.</li>
          <li>Lenni reads the need back.</li>
          <li>Lenni proposes a starting workspace.</li>
          <li>You see what will be created.</li>
          <li>The workspace remains editable.</li>
          <li>The business runs from normal software.</li>
        </ol>
      </section>

      <section
        className="marketing-article-closing"
        aria-labelledby="closing-title"
      >
        <p className="marketing-kicker">Early access</p>
        <h2 id="closing-title">
          See what a calmer workspace could look like for your business.
        </h2>
        <p>
          Lenni is not generally available yet. Join the waitlist for early
          access and a first look when it&apos;s ready.
        </p>
        <div className="marketing-article-actions">
          <EarlyAccessLink className="marketing-button" />
          <Link className="marketing-text-button" href="/">
            Back to Lenni <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
