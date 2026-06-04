import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  description: string;
  icon: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Automatic Capture',
    icon: '🔍',
    description:
      'Claude emits #lesson tags when it makes mistakes; the scanner finds patterns in session logs without any manual work. Two-tier scanning — structured tags and heuristic pattern detection — means nothing slips through.',
  },
  {
    title: 'Precision Injection',
    icon: '🎯',
    description:
      'Relevant warnings appear in context right before the relevant tool call fires — not a wall of rules, just the right thing at the right time. Lessons are matched by tool name, command pattern, and file path so only what applies shows up.',
  },
  {
    title: 'It Compounds',
    icon: '📈',
    description:
      'Every corrected mistake makes the next session smarter. Lessons are scoped, deduplicated, and ranked by recurrence. Over time the agent builds an ever-more-refined playbook shaped entirely by your own codebase and workflow.',
  },
];

function Feature({ title, icon, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.featureCard}>
        <div className={styles.featureIcon}>{icon}</div>
        <Heading as="h3" className={styles.featureTitle}>
          {title}
        </Heading>
        <p className={styles.featureDescription}>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
