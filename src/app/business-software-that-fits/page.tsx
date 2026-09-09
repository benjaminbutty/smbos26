import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  FitConnectedSnapshot,
  FitDemoProvider,
  FitDetailsExplorer,
  FitHeroWorkspace,
  FitRecordDialog,
} from "../../components/business-software-fit-demo";
import { EarlyAccessForm } from "../../components/early-access-form";
import styles from "./business-software-that-fits.module.css";

const route = "/business-software-that-fits";
const pageTitle = "Customisable CRM & Business Software That Fits | Lenni";
const pageDescription =
  "A flexible, connected workspace for small businesses that want customer information, work and useful stages to fit the way they operate.";

export const metadata: Metadata = {
  title: { absolute: pageTitle },
  description: pageDescription,
  alternates: { canonical: route },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    type: "website",
    url: route,
    images: ["/og-lenni.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
    images: ["/og-lenni.png"],
  },
};

export default function BusinessSoftwareThatFitsPage(): ReactNode {
  return (
    <FitDemoProvider>
      <main className={styles.page} id="main" tabIndex={-1}>
        <section aria-labelledby="fit-hero-title" className={styles.hero}>
          <div className={styles.wrap}>
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>Flexible business software</p>
                <h1 className={styles.heroTitle} id="fit-hero-title">
                  Finally, software
                  <br />
                  that feels like
                  <br />
                  <span>your business.</span>
                </h1>
                <p className={styles.heroDescription}>
                  Your customers. Your stages. Your way of getting things done.
                  Bring them together in a workspace you can make your own.
                </p>
                <div className={styles.heroActions}>
                  <a className={styles.primaryButton} href="#early-access">
                    Get early access <span aria-hidden="true">→</span>
                  </a>
                  <a className={styles.textLink} href="#fit-details">
                    See it your way <span aria-hidden="true">↓</span>
                  </a>
                </div>
                <p className={styles.heroNote}>
                  <span aria-hidden="true">✓</span> For small businesses. Not
                  just sales teams.
                </p>
              </div>
              <FitHeroWorkspace />
            </div>
            <div
              className={styles.promises}
              aria-label="What Lenni is made for"
            >
              <p className={styles.promise}>
                <span>01</span> <strong>Your language.</strong> Familiar from
                the start.
              </p>
              <p className={styles.promise}>
                <span>02</span> <strong>Your work.</strong> Connected, not
                scattered.
              </p>
              <p className={styles.promise}>
                <span>03</span> <strong>Your next step.</strong> Room to change.
              </p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="recognition-title"
          className={styles.recognition}
        >
          <div className={`${styles.wrap} ${styles.recognitionGrid}`}>
            <h2 id="recognition-title">
              You didn&apos;t build a
              <br />
              one-size-fits-all business.
              <br />
              <span>Why run it that way?</span>
            </h2>
            <p className={styles.recognitionCopy}>
              The extra tab. The field that almost fits. The workaround everyone
              has to remember.
              <br />
              <br />
              <strong>
                You don&apos;t need another way around the software. You need a
                better fit.
              </strong>
            </p>
          </div>
        </section>

        <section
          aria-labelledby="fit-details-title"
          className={styles.fitSection}
          id="fit-details"
        >
          <div className={styles.wrap}>
            <div className={styles.sectionIntro}>
              <div>
                <p className={styles.eyebrow}>
                  The details make the difference
                </p>
                <h2 id="fit-details-title">
                  A better fit.
                  <br />
                  Right down to the details.
                </h2>
              </div>
              <p>
                Lenni brings customers and work into one connected workspace.
                Shape the names, stages and views around the way you do things.
              </p>
            </div>
            <FitDetailsExplorer />
          </div>
        </section>

        <section
          aria-labelledby="grow-title"
          className={styles.growSection}
          id="room-to-grow"
        >
          <div className={`${styles.wrap} ${styles.growLayout}`}>
            <div className={styles.growCopy}>
              <p className={styles.eyebrow}>Make room for what&apos;s next</p>
              <h2 id="grow-title">
                Shape your workspace.
                <br />
                <span>
                  Get on with
                  <br />
                  the business.
                </span>
              </h2>
              <p>
                A new service. A different way of working. Another detail worth
                keeping. Your workspace should have room for the next chapter,
                not just the one you started with.
              </p>
              <p className={styles.growLine}>
                <span aria-hidden="true">⌕</span>
                <span>
                  Edit directly, or ask Lenni for a supported change. You review
                  it before it takes effect.
                </span>
              </p>
              <p className={styles.demoDisclosure}>
                Example states are explicitly tracked. No email or messages are
                being monitored.
              </p>
            </div>
            <FitConnectedSnapshot />
          </div>
        </section>

        <section
          aria-label="Questions about Lenni"
          className={styles.questions}
        >
          <div className={`${styles.wrap} ${styles.questionsLayout}`}>
            <div className={styles.questionsTitle}>
              <strong>A few things you might be wondering.</strong>
              No new language to learn.
            </div>
            <div>
              <details className={styles.faq}>
                <summary>
                  Is Lenni just a CRM? <span aria-hidden="true">＋</span>
                </summary>
                <p>
                  Customer management can be your starting point, not the whole
                  system. A Lenni workspace can also hold your enquiries,
                  projects, jobs or other business information, connected in a
                  way that makes sense to your team.
                </p>
              </details>
              <details className={styles.faq}>
                <summary>
                  Do I have to build the software myself?{" "}
                  <span aria-hidden="true">＋</span>
                </summary>
                <p>
                  You shape a workspace inside Lenni, rather than write and
                  maintain an app. Edit it directly, or ask for help with
                  supported changes. You decide whether the proposed setup fits.
                </p>
              </details>
              <details className={styles.faq}>
                <summary>
                  Can I change it as the business grows?{" "}
                  <span aria-hidden="true">＋</span>
                </summary>
                <p>
                  Yes. Names, the information you keep, and useful views can
                  change with the business. Supported setup changes are shown
                  for review before they take effect. Lenni does not promise to
                  replace every specialist tool or integration.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section className={styles.closingWrap} id="early-access">
          <div className={styles.closing}>
            <div className={`${styles.wrap} ${styles.closingContent}`}>
              <div className={styles.closingCopy}>
                <p className={styles.eyebrow}>
                  Your business, with a little more room
                </p>
                <h2>
                  That&apos;s more like
                  <br />
                  your business.
                </h2>
                <p>
                  Start with the part you want to run better.
                  <br />
                  Your enquiries. Your projects. Your next chapter.
                </p>
              </div>
              <div>
                <EarlyAccessForm className={styles.accessForm} />
                <p className={styles.availability}>
                  Lenni is not generally available yet. Join the waitlist for
                  early access and a first look when it&apos;s ready.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <FitRecordDialog />
    </FitDemoProvider>
  );
}
