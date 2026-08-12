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
    title: "Shape the right setup",
    text: "SMBOS helps turn that into the customers, products, orders, enquiries and screens you need.",
  },
  {
    number: "03",
    title: "Review important changes",
    text: "See what is being proposed before a material change becomes live.",
  },
  {
    number: "04",
    title: "Run the business normally",
    text: "Your team works from clear lists, forms and pages. Come back to Builder when things change.",
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
      aria-label="A product preview showing an operational Orders screen, Builder and a reviewed change"
    >
      <div className="preview-window-bar">
        <span className="preview-window-dot preview-window-dot-coral" />
        <span className="preview-window-dot preview-window-dot-amber" />
        <span className="preview-window-dot preview-window-dot-green" />
        <span className="preview-window-title">SMBOS workspace</span>
      </div>

      <div className="preview-workspace">
        <aside className="preview-rail" aria-hidden="true">
          <div className="preview-app-mark">S</div>
          <div className="preview-rail-label">Northstar Bakehouse</div>
          <span className="preview-rail-heading">Work</span>
          <span className="preview-rail-item preview-rail-item-active">
            <span className="preview-rail-icon">□</span> Orders
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">○</span> Products
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">◇</span> Customers
          </span>
          <span className="preview-rail-heading preview-rail-heading-spaced">
            Setup
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">✦</span> Builder
          </span>
          <span className="preview-rail-item">
            <span className="preview-rail-icon">↗</span> Changes
          </span>
        </aside>

        <div className="preview-main">
          <div className="preview-page-heading">
            <div>
              <span className="preview-overline">
                Today · Northstar Bakehouse
              </span>
              <strong>Orders</strong>
            </div>
            <span className="preview-live-chip">
              <span /> Live
            </span>
          </div>

          <div className="preview-toolbar">
            <span className="preview-search">⌕ Search orders</span>
            <span className="preview-filter">All statuses⌄</span>
            <span className="preview-filter">Today⌄</span>
          </div>

          <div className="preview-content-grid">
            <section className="preview-orders-card" aria-label="Orders list">
              <div className="preview-card-heading">
                <strong>Upcoming collections</strong>
                <span>8 orders</span>
              </div>
              <div className="preview-table-head">
                <span>Customer</span>
                <span>Collection</span>
                <span>Status</span>
              </div>
              <div className="preview-order-row">
                <span>
                  <b>Amelia Reed</b>
                  <small>#1048 · Afternoon Tea Box</small>
                </span>
                <span>Bedford · 11:30</span>
                <span className="preview-status preview-status-ready">
                  Ready
                </span>
              </div>
              <div className="preview-order-row">
                <span>
                  <b>Jon Bell</b>
                  <small>#1047 · Celebration Box</small>
                </span>
                <span>Bedford · 12:00</span>
                <span className="preview-status preview-status-confirmed">
                  Confirmed
                </span>
              </div>
              <div className="preview-order-row">
                <span>
                  <b>Priya Shah</b>
                  <small>#1046 · Kids Afternoon Tea</small>
                </span>
                <span>Milton Keynes · 12:30</span>
                <span className="preview-status preview-status-new">New</span>
              </div>
            </section>

            <aside
              className="preview-builder-card"
              aria-label="Builder change preview"
            >
              <div className="preview-builder-topline">
                <span className="preview-builder-spark">✦</span>
                <span>Builder</span>
                <span className="preview-suggestion-chip">Suggestion</span>
              </div>
              <p className="preview-builder-request">
                “Add an optional dietary requirements question to preorders.”
              </p>
              <div className="preview-change-card">
                <div>
                  <span className="preview-proposed-dot" />
                  <strong>Ready to review</strong>
                </div>
                <span className="preview-change-label">1 change</span>
                <p>Dietary requirements · Optional question</p>
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
            An operating platform for independent businesses
          </p>
          <h1 id="home-title">
            Run your business.
            <span>Your way.</span>
          </h1>
          <p className="marketing-hero-lede">
            Everything you need to run your business, shaped around how you
            work. Keep customers, products, orders, enquiries and the rest of
            the business connected in one place — without forcing your business
            into someone else&apos;s process.
          </p>
          <div className="marketing-hero-actions">
            <a className="marketing-button" href="/start">
              Start with Lenni
            </a>
            <a className="marketing-text-button" href="/sign-up">
              Build manually <span aria-hidden="true">↘</span>
            </a>
          </div>
          <p className="marketing-hero-note">
            See a useful starting point before you create an account.
          </p>
        </div>

        <div className="marketing-hero-visual">
          <ProductPreview />
          <p className="marketing-visual-caption">
            Normal day-to-day work, with a clearer way to shape what comes next.
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
        id="why-smbos"
        aria-labelledby="contrast-title"
      >
        <div className="marketing-section-intro">
          <p className="marketing-kicker">Why SMBOS</p>
          <h2 id="contrast-title">
            Your business shouldn&apos;t have to fit the tool.
          </h2>
          <p>
            Small businesses often end up split across spreadsheets, inboxes,
            specialist apps, messaging threads and manual processes. Even
            flexible tools can leave the owner to figure out how everything
            should fit together.
          </p>
        </div>

        <div className="marketing-reason-grid">
          <article className="marketing-reason-card">
            <span className="marketing-card-number">01</span>
            <h3>Built around your business</h3>
            <p>
              Start from how the business actually works, not from a rigid
              template.
            </p>
          </article>
          <article className="marketing-reason-card">
            <span className="marketing-card-number">02</span>
            <h3>Connected by default</h3>
            <p>
              Customers, orders, products, enquiries and more belong in one
              operating environment.
            </p>
          </article>
          <article className="marketing-reason-card">
            <span className="marketing-card-number">03</span>
            <h3>Made to change</h3>
            <p>
              Let the setup evolve as the business does, without rebuilding from
              scratch.
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
            Tell us how your business works. SMBOS helps shape the rest.
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
            These are different business shapes, not separate SMBOS products.
            The same flexible foundation can make room for the way each one
            works.
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
            Use Builder when you want help planning or changing the business.
            SMBOS prepares the work; important system changes stay reviewable
            and deliberate. Day-to-day operation remains clear and usable
            without AI.
          </p>
        </div>
        <div className="marketing-control-grid">
          <div className="marketing-control-card marketing-control-card-coral">
            <span className="marketing-control-label">Builder helps with</span>
            <ul>
              <li>Understanding what you need</li>
              <li>Preparing new concepts and screens</li>
              <li>Preparing supported changes</li>
              <li>Helping the setup evolve</li>
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
          <h2 id="faq-title">A clearer way to think about SMBOS.</h2>
        </div>
        <div className="marketing-faq-list">
          <details>
            <summary>What is SMBOS?</summary>
            <p>
              A flexible operating platform for small businesses that helps you
              build and run the setup your business actually needs.
            </p>
          </details>
          <details>
            <summary>Do I need to know how to build databases or apps?</summary>
            <p>
              No. SMBOS is designed around business language and normal
              operating screens rather than technical system-building concepts.
            </p>
          </details>
          <details>
            <summary>Is SMBOS just an AI chatbot?</summary>
            <p>
              No. AI helps plan and change the setup. The business itself runs
              through clear product screens and continues to work without AI.
            </p>
          </details>
          <details>
            <summary>What kinds of businesses is it for?</summary>
            <p>
              SMBOS is being designed for independent businesses with very
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
