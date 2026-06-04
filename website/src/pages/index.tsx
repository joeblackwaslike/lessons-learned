import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

function HomepageHero() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">
          Stop repeating Claude's mistakes. Every session, automatically.
        </p>
        <div className={styles.installCommand}>
          claude /plugin install lessons-learned@agent-marketplace
        </div>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro"
          >
            Get Started
          </Link>
          <Link
            className={clsx(
              'button button--outline button--lg',
              styles.buttonGhost,
            )}
            href="https://github.com/joeblackwaslike/lessons-learned"
          >
            GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

function PlatformSupport() {
  const platforms = [
    'Claude Code',
    'Codex CLI',
    'Gemini CLI',
    'opencode',
    'Cursor',
  ];
  return (
    <section className={styles.platformSection}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Platform Support
        </Heading>
        <div className={styles.platformGrid}>
          {platforms.map((platform) => (
            <span key={platform} className={styles.platformBadge}>
              {platform}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className={styles.howItWorksSection}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          How It Works
        </Heading>
        <p className={styles.sectionSubtitle}>
          A continuous capture-inject loop that gets smarter every session.
        </p>
        <div className={styles.mermaidContainer}>
          <pre className="mermaid">
            {`flowchart LR
    A["Claude makes a mistake"] --> B["Emits #lesson tag\\nor scanner detects pattern"]
    B --> C["Candidate stored\\nin lessons.db"]
    C --> D["Review and promote\\nvia CLI"]
    D --> E["lesson-manifest.json\\nrebuilt"]
    E --> F["Next session:\\nPreToolUse hook fires"]
    F --> G{"Lesson matches\\ntool + pattern?"}
    G -- Yes --> H["Warning injected\\nbefore tool call"]
    G -- No --> I["Skipped — no noise"]
    H --> J["Mistake avoided"]`}
          </pre>
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHero />
      <main>
        <HomepageFeatures />
        <PlatformSupport />
        <HowItWorks />
      </main>
    </Layout>
  );
}
