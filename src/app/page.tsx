import type { ReactNode } from "react";
import Image from "next/image";

import { EarlyAccessForm } from "../components/early-access-form";
import { MarketingExampleShowcase } from "../components/marketing-example-showcase";
import styles from "./marketing-home.module.css";

export default function HomePage(): ReactNode {
  return (
    <main id="main" className={styles.home} tabIndex={-1}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.tinyLine} aria-hidden="true" /> For
            independent businesses
          </p>
          <h1 id="hero-title" className={styles.heroTitle}>
            For the business <br />
            only <span className={styles.coral}>you</span>
            <br />
            could build.
          </h1>
          <p className={styles.heroDescription}>
            A flexible workspace shaped around how you work.
            <br className={styles.desktopBreak} /> Your customers, your plans,
            your next big thing.
          </p>
          <div className={styles.heroActions}>
            <a
              className={`${styles.button} ${styles.primary}`}
              href="#possibilities"
            >
              See what&apos;s possible <span aria-hidden="true">↗</span>
            </a>
            <span className={styles.actionNote}>
              A little look inside Lenni.
            </span>
          </div>
        </div>

        <div className={styles.heroArt}>
          <figure className={styles.portrait}>
            <Image
              className={styles.portraitImage}
              src="/marketing/independent-florist.png"
              width={1024}
              height={1536}
              sizes="(max-width: 620px) calc(100vw - 44px), (max-width: 1150px) 46vw, 50vw"
              priority
              alt="Illustrative photograph of an independent florist tying a bouquet in her sunlit studio"
            />
            <figcaption className={styles.portraitCaption}>
              Independent by nature.
            </figcaption>
          </figure>
          <div
            className={styles.heroPreview}
            aria-label="Illustrative Lenni order list with fictional example data"
          >
            <div className={styles.previewLabel}>
              <span>Petal &amp; Stem</span>
              <span className={styles.exampleLabel}>Example workspace</span>
            </div>
            <h2>A Saturday in full bloom.</h2>
            <div className={styles.miniHead}>
              <span>Collection orders</span>
              <span>Customer</span>
            </div>
            {[
              ["The big birthday bouquet", "Alice Morgan"],
              ["A little thank you", "Tom Lewis"],
              ["Just because", "Sam Patel"],
            ].map(([order, customer]) => (
              <div className={styles.miniRow} key={order}>
                <span>
                  <span className={styles.orderDot} aria-hidden="true" />
                  {order}
                </span>
                <span>{customer}</span>
              </div>
            ))}
            <div className={styles.miniFoot}>
              <span>Your work. Everything in its place.</span>
              <span aria-hidden="true">↗</span>
            </div>
          </div>
        </div>
      </section>

      <div className={`${styles.wrap} ${styles.audience}`}>
        <p>
          Different businesses. <br />
          <b>The same independent spirit.</b>
        </p>
        <div>
          <span>The early starters.</span>
          <span>The hands-on makers.</span>
          <span>The next-chapter thinkers.</span>
        </div>
      </div>

      <section className={styles.why} id="why" aria-labelledby="why-title">
        <div className={`${styles.wrap} ${styles.whyInner}`}>
          <div>
            <p className={styles.eyebrow}>Sound familiar?</p>
            <h2 id="why-title">
              Eventually, <br />
              you are the system.
            </h2>
          </div>
          <div className={styles.whyCopy}>
            <p>
              The details in your head. The messages to remember. The
              spreadsheet only you understand.
            </p>
            <p className={styles.whyEmphasis}>
              You&apos;ve built something worth growing. <br />
              Let&apos;s give it room.
            </p>
          </div>
        </div>
      </section>

      <section
        className={`${styles.wrap} ${styles.possibilities}`}
        id="possibilities"
        aria-labelledby="possibilities-title"
      >
        <div className={styles.sectionIntro}>
          <div>
            <p className={styles.eyebrow}>This is where Lenni comes in</p>
            <h2 id="possibilities-title">
              Start with your business. <br />
              See what takes shape.
            </h2>
          </div>
          <p>
            Tell Lenni what you need. <br />
            Review a starting point. <br />
            Make it yours.
          </p>
        </div>
        <MarketingExampleShowcase />
      </section>

      <section
        className={`${styles.wrap} ${styles.future}`}
        aria-labelledby="future-title"
      >
        <div className={styles.futureRule} aria-hidden="true" />
        <p className={styles.eyebrow}>The bigger idea</p>
        <h2 id="future-title">
          A business changes. <br />
          Its software should, too.
        </h2>
        <p>
          We&apos;re building Lenni to grow with independent businesses.
          <br />
          Starting with a clearer home for the work. Shaped by what comes next.
        </p>
      </section>

      <section
        className={styles.earlyAccess}
        id="early-access"
        aria-labelledby="access-title"
      >
        <div className={`${styles.wrap} ${styles.accessInner}`}>
          <div>
            <p className={styles.eyebrow}>Help shape the next chapter</p>
            <h2 id="access-title">
              Make room <br />
              for what&apos;s next.
            </h2>
          </div>
          <div className={styles.accessCopy}>
            <p>
              Building something your own way? <br />
              We&apos;d love you to be part of Lenni&apos;s beginning.
            </p>
            <div className={styles.formFrame}>
              <EarlyAccessForm
                className={styles.accessForm}
                showBusinessType={false}
              />
              <p className={styles.availability}>
                Lenni is not generally available yet.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`${styles.wrap} ${styles.questions}`}
        aria-label="A few useful answers"
      >
        <details>
          <summary>What can I do with Lenni?</summary>
          <p>
            Lenni is being built around connected customer and business
            information, editable tables and pages, and reviewable setup
            proposals. Early access will open in stages.
          </p>
        </details>
        <details>
          <summary>Will I still be in control?</summary>
          <p>
            Yes. AI helps propose a starting point or a supported change. You
            review the proposal and work through ordinary, editable software day
            to day.
          </p>
        </details>
        <details>
          <summary>Does it connect to the tools I already use?</summary>
          <p>
            WhatsApp, email and other integrations are future ideas. This shows
            information you keep in Lenni, not automatic syncing from other
            tools.
          </p>
        </details>
      </section>
    </main>
  );
}
