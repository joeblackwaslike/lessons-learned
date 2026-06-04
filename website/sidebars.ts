import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'User Guide',
      items: [
        'user-guide/how-it-works',
        'user-guide/lessons',
        'user-guide/emitting-lessons',
        'user-guide/scanning',
        'user-guide/configuration',
        'user-guide/installation',
        'user-guide/slash-commands',
        'user-guide/anti-compact',
      ],
    },
    {
      type: 'category',
      label: 'Developer Guide',
      items: [
        'developer-guide/architecture',
        'developer-guide/data-model',
        'developer-guide/adapters',
        'developer-guide/testing',
        'developer-guide/eval-usage',
        'developer-guide/eval-scenario-writing',
        'developer-guide/contributing',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/cli',
        'reference/hooks',
        'reference/configuration',
        'reference/schemas',
        'reference/tags',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      collapsed: true,
      items: [
        'architecture/constitution',
        'architecture/project',
        'architecture/data-model',
        'architecture/testing-plan',
        'architecture/quality-checks',
      ],
    },
    {
      type: 'category',
      label: 'PRDs',
      collapsed: true,
      items: [
        'prds/lessons-learned-plugin',
        'prds/lessons-review-command',
        'prds/mcp-server',
        'prds/eval-framework',
        'prds/posttooluse-context-aware-reinject',
      ],
    },
    {
      type: 'category',
      label: 'Research',
      collapsed: true,
      items: [
        'research/real-world-demand',
        'research/context-and-degredation',
      ],
    },
    {
      type: 'category',
      label: 'Post-Mortems',
      collapsed: true,
      items: [
        'post-mortems/codex-chat-history-sidebar-postmortem',
      ],
    },
  ],
};

export default sidebars;
