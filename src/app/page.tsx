import type { ReactNode } from "react";

import { EarlyAccessForm } from "../components/early-access-form";

const steps = [
  {
    number: "01",
    title: "Describe what you need",
    text: "Explain the business problem in the words you already use.",
  },
  {
    number: "02",
    title: "Start with a real workspace",
    text: "Lenni turns that into a starting workspace with the Tables, Pages and information your business needs.",
  },
  {
    number: "03",
    title: "Review what changes",
    text: "See a clear starting point and review important changes before they become live.",
  },
  {
    number: "04",
    title: "Keep the work moving",
    text: "Your team works from clear Tables and Pages. Tell Lenni again whenever the business changes.",
  },
];

const businessExamples = [
  {
    label: "Bakery",
    title: "Products, Customers, Preorders, Collections",
    tone: "coral",
  },
  {
    label: "Mobile groomer",
    title: "Customers, Pets, Visits, Notes",
    tone: "lavender",
  },
  {
    label: "Milk round",
    title: "Customers, Products, Standing Orders, Delivery Days",
    tone: "mint",
  },
  {
    label: "Catering business",
    title: "Customers, Enquiries, Events, Follow-ups",
    tone: "sand",
  },
];

function ProductPreview(): ReactNode {
  return (
    <div
      className="product-preview"
      role="img"
      aria-label="A Lenni workspace showing Home, Tables, Pages and a reviewed change"
    >
      <div className="preview-window-bar">
        <span className="preview-window-dot preview-window-dot-coral" />
        <span className="preview-window-dot preview-window-dot-amber" />
        <span className="preview-window-dot preview-window-dot-green" />
        <span className="preview-window-title">Lenni workspace</span>
      </div>

      <div className="preview-workspace">
        <aside className="preview-rail" aria-hidden="true">
          <div className="preview-app-mark">L</div>
          <div className="preview-rail-label">Marlow Bakehouse</div>
          <span className="preview-rail-item preview-rail-item-active">
            <span className="preview-rail-icon">⌂</span> Home
          </span>
          <span className="preview-rail-heading preview-rail-heading-spaced">
            Tables
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">□</span> Orders
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">○</span> Customers
          </span>
          <span className="preview-rail-heading preview-rail-heading-spaced">
            Pages
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">▤</span> Collection plan
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">◎</span> Settings
          </span>
        </aside>

        <div className="preview-main">
          <div className="preview-page-heading">
            <div>
              <span className="preview-overline">Marlow Bakehouse</span>
              <strong>Home</strong>
            </div>
            <span className="preview-live-chip">
              <span /> Live workspace
            </span>
          </div>

          <div className="preview-toolbar">
            <span className="preview-search">Good morning, Jamie</span>
            <span className="preview-filter">Today</span>
            <span className="preview-filter">Tell Lenni →</span>
          </div>

          <div className="preview-content-grid">
            <section
              className="preview-orders-card"
              aria-label="Workspace overview"
            >
              <div className="preview-card-heading">
                <strong>Start here</strong>
                <span>Live workspace</span>
              </div>
              <div className="preview-table-head">
                <span>What&apos;s ready</span>
                <span>Next step</span>
                <span>Status</span>
              </div>
              <div className="preview-order-row">
                <span>
                  <b>Today&apos;s orders</b>
                  <small>Orders Table · 8 records</small>
                </span>
                <span>Open Table</span>
                <span className="preview-status preview-status-ready">
                  Ready
                </span>
              </div>
              <div className="preview-order-row">
                <span>
                  <b>Collection plan</b>
                  <small>Workspace Page · Draft</small>
                </span>
                <span>Review Page</span>
                <span className="preview-status preview-status-confirmed">
                  In progress
                </span>
              </div>
              <div className="preview-order-row">
                <span>
                  <b>Customer follow-ups</b>
                  <small>Customers Table · 4 to review</small>
                </span>
                <span>Open Table</span>
                <span className="preview-status preview-status-new">New</span>
              </div>
            </section>

            <aside
              className="preview-builder-card"
              aria-label="Tell Lenni change preview"
            >
              <div className="preview-builder-topline">
                <span className="preview-builder-spark">✦</span>
                <span>Tell Lenni</span>
                <span className="preview-suggestion-chip">Proposed</span>
              </div>
              <p className="preview-builder-request">
                “Create a page for this week&apos;s collection plan.”
              </p>
              <div className="preview-change-card">
                <div>
                  <span className="preview-proposed-dot" />
                  <strong>Ready to review</strong>
                </div>
                <span className="preview-change-label">1 Page</span>
                <p>Collection plan · Ready to add</p>
              </div>
              <span className="preview-review-link">Review change →</span>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage(): ReactNode {
  return (
    <main className="marketing-home">
      <section className="marketing-hero" aria-labelledby="home-title">
        <div className="marketing-hero-copy">
          <p className="marketing-kicker">
            A workspace for independent businesses
          </p>
          <h1 id="home-title">
            Your business,
            <span>in one calm workspace.</span>
          </h1>
          <p className="marketing-hero-lede">
            Bring the work that keeps your business moving into one connected,
            editable workspace. Start with Lenni, or shape it yourself — either
            way, it stays built around how you work.
          </p>
          <div className="marketing-hero-actions">
            <a className="marketing-button" href="#early-access">
              Show me what Lenni would build
            </a>
            <a className="marketing-text-button" href="/outgrown-spreadsheets">
              Outgrown spreadsheets? Read more <span aria-hidden="true">↘</span>
            </a>
          </div>
          <p className="marketing-hero-note">
            Join early access to see Lenni when it&apos;s ready.
          </p>
        </div>

        <div className="marketing-hero-visual">
          <ProductPreview />
          <p className="marketing-visual-caption">
            A real workspace for everyday work, with a clearer way to shape what
            comes next.
          </p>
        </div>
      </section>

      <div className="marketing-audience-line" aria-label="Business examples">
        <span>For businesses that work differently</span>
        <div>
          <span>Bakery</span>
          <span>Salon</span>
          <span>Independent retail</span>
          <span>Mobile services</span>
          <span>Catering</span>
        </div>
      </div>

      <section
        className="marketing-section marketing-contrast-section"
        id="why-lenni"
        aria-labelledby="contrast-title"
      >
        <div className="marketing-section-intro">
          <p className="marketing-kicker">Why Lenni</p>
          <h2 id="contrast-title">Start with your work, not a blank system.</h2>
          <p>
            Small businesses often end up split across spreadsheets, inboxes,
            specialist apps, messaging threads and manual processes. Lenni gives
            that work a clearer home without asking you to become a system
            designer first.
          </p>
        </div>

        <div className="marketing-reason-grid">
          <article className="marketing-reason-card">
            <span className="marketing-card-number">01</span>
            <h3>Built around your business</h3>
            <p>
              Begin with what the business needs to do, not a generic setup to
              decode.
            </p>
          </article>
          <article className="marketing-reason-card">
            <span className="marketing-card-number">02</span>
            <h3>One connected workspace</h3>
            <p>
              Keep customers, orders, plans and the rest of your work together
              in one place.
            </p>
          </article>
          <article className="marketing-reason-card">
            <span className="marketing-card-number">03</span>
            <h3>Made to evolve</h3>
            <p>
              Review a new starting point or a change before it becomes part of
              the workspace.
            </p>
          </article>
        </div>
      </section>

      <section
        className="marketing-section marketing-how-section"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="marketing-section-intro marketing-section-intro-narrow">
          <p className="marketing-kicker">How it works</p>
          <h2 id="how-title">
            Tell Lenni what you need. Start with a workspace that makes sense.
          </h2>
        </div>
        <div className="marketing-steps">
          {steps.map((step) => (
            <article className="marketing-step" key={step.number}>
              <span className="marketing-step-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="marketing-section marketing-business-section"
        aria-labelledby="businesses-title"
      >
        <div className="marketing-section-intro">
          <p className="marketing-kicker">One platform, different businesses</p>
          <h2 id="businesses-title">
            Your business decides what belongs in it.
          </h2>
          <p>
            These are different business shapes, not separate products. Lenni
            makes room for the way each one works.
          </p>
        </div>
        <div className="marketing-business-grid">
          {businessExamples.map((example) => (
            <article
              className={`marketing-business-card marketing-business-card-${example.tone}`}
              key={example.label}
            >
              <span>{example.label}</span>
              <h3>{example.title}</h3>
              <span className="marketing-business-arrow" aria-hidden="true">
                ↗
              </span>
            </article>
          ))}
        </div>
      </section>

      <section
        className="marketing-section marketing-control-section"
        id="control"
        aria-labelledby="control-title"
      >
        <div className="marketing-control-copy">
          <p className="marketing-kicker">AI + control</p>
          <h2 id="control-title">
            AI helps you build. It doesn&apos;t run the show.
          </h2>
          <p>
            Tell Lenni what you need when you want a useful starting point or a
            proposed change. You can review it before it goes live, while
            day-to-day work stays clear and usable without AI.
          </p>
        </div>
        <div className="marketing-control-grid">
          <div className="marketing-control-card marketing-control-card-coral">
            <span className="marketing-control-label">Lenni helps with</span>
            <ul>
              <li>Understanding what you need</li>
              <li>Preparing a useful starting workspace</li>
              <li>Preparing reviewable changes</li>
              <li>Helping the workspace evolve</li>
            </ul>
          </div>
          <div className="marketing-control-card marketing-control-card-dark">
            <span className="marketing-control-label">
              You stay in control of
            </span>
            <ul>
              <li>What becomes live</li>
              <li>Normal business operation</li>
              <li>Manual edits</li>
              <li>The final shape of the system</li>
            </ul>
          </div>
        </div>
      </section>

      <section
        className="marketing-section marketing-faq-section"
        id="faq"
        aria-labelledby="faq-title"
      >
        <div className="marketing-section-intro marketing-section-intro-narrow">
          <p className="marketing-kicker">A few useful answers</p>
          <h2 id="faq-title">A clearer way to think about Lenni.</h2>
        </div>
        <div className="marketing-faq-list">
          <details>
            <summary>What is Lenni?</summary>
            <p>
              Lenni is a flexible business workspace that helps you build and
              run the setup your business actually needs.
            </p>
          </details>
          <details>
            <summary>Do I need to know how to build databases or apps?</summary>
            <p>
              No. Lenni is designed around business language and normal
              operating screens rather than technical system-building concepts.
            </p>
          </details>
          <details>
            <summary>Is Lenni just an AI chatbot?</summary>
            <p>
              No. AI helps plan and change the setup. The business itself runs
              through clear product screens and continues to work without AI.
            </p>
          </details>
          <details>
            <summary>What kinds of businesses is it for?</summary>
            <p>
              Lenni is being designed for independent businesses with very
              different operating models — from cafés and retailers to mobile
              services, hospitality and enquiry-led businesses.
            </p>
          </details>
        </div>
      </section>

      <section
        className="marketing-early-access"
        id="early-access"
        aria-labelledby="early-access-title"
      >
        <div className="marketing-early-access-copy">
          <p className="marketing-kicker">Early access</p>
          <h2 id="early-access-title">
            Build the way your business actually works.
          </h2>
          <p>Join the list for a first look when early access opens.</p>
        </div>
        <EarlyAccessForm />
      </section>
    </main>
  );
}
