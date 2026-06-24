import { useEffect } from 'react';

export type LegalPageKind = 'terms' | 'privacy';

interface LegalSection {
  title: string;
  body: string[];
}

interface LegalPageCopy {
  eyebrow: string;
  title: string;
  intro: string;
  sections: LegalSection[];
}

const LAST_UPDATED = 'June 24, 2026';

const LEGAL_COPY: Record<LegalPageKind, LegalPageCopy> = {
  terms: {
    eyebrow: 'Terms',
    title: 'Terms of Service',
    intro: 'These Terms of Service describe the rules for accessing and using Slop Heroes.',
    sections: [
      {
        title: 'Use of Slop Heroes',
        body: [
          'Slop Heroes is a multiplayer browser game. You may use the service only if you can form a binding agreement and only where use of the service is lawful.',
          'You are responsible for the activity that happens through your account and for keeping your Discord account or connected wallet secure.',
        ],
      },
      {
        title: 'Accounts and Authentication',
        body: [
          'You can create and access a Slop Heroes account with Discord, a supported Solana wallet, or both. Ranked modes may require a linked wallet before entry.',
          'You may not impersonate another person, sell or transfer your account, bypass eligibility checks, or attempt to link accounts or wallets that you do not control.',
        ],
      },
      {
        title: 'Fair Play',
        body: [
          'Cheating, exploiting bugs, tampering with the client or network traffic, automated play, abusive behavior, harassment, and attempts to disrupt matches are prohibited.',
          'We may restrict, suspend, or remove access when we believe activity threatens game integrity, player safety, or the operation of the service.',
        ],
      },
      {
        title: 'Wallets',
        body: [
          'If wallet-enabled features are available, you are responsible for reviewing wallet prompts, transaction details, network fees, eligibility requirements, and local laws before participating.',
          'Blockchain transactions may be irreversible. Slop Heroes does not control Discord, wallet software, blockchain networks, or third-party infrastructure.',
        ],
      },
      {
        title: 'Service Changes',
        body: [
          'Slop Heroes may change, pause, or discontinue features, game modes, balances, rewards, or access requirements at any time.',
          'The service is provided as-is and as-available. We do not guarantee uninterrupted access, matchmaking availability, or error-free operation.',
        ],
      },
      {
        title: 'Contact',
        body: [
          'Questions about these terms can be sent through the official Slop Heroes support or community channels.',
        ],
      },
    ],
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Privacy Policy',
    intro: 'This Privacy Policy explains what Slop Heroes collects and how that information is used.',
    sections: [
      {
        title: 'Information We Collect',
        body: [
          'When you sign in with Discord, we receive basic Discord account information such as your Discord user ID, username, display name, and avatar.',
          'When you sign in or connect with a wallet, we collect the wallet address you choose to use. We also collect gameplay, matchmaking, device, diagnostic, security, and anti-cheat information needed to operate the game.',
        ],
      },
      {
        title: 'How We Use Information',
        body: [
          'We use information to authenticate players, create profiles, run matchmaking, enforce fair play, maintain ranked or wallet-gated features, secure the service, debug issues, and improve game quality.',
          'Session cookies or similar browser storage may be used to keep you signed in and to protect authentication flows.',
        ],
      },
      {
        title: 'Sharing',
        body: [
          'We do not sell personal information. We may share information with service providers that help host, secure, authenticate, monitor, or operate Slop Heroes.',
          'Discord, wallet providers, hosting providers, and blockchain networks process information under their own policies when you interact with them.',
        ],
      },
      {
        title: 'Retention and Security',
        body: [
          'We keep information for as long as needed to provide the service, comply with obligations, resolve disputes, enforce rules, and maintain security records.',
          'We use reasonable safeguards, but no online service can guarantee absolute security.',
        ],
      },
      {
        title: 'Your Choices',
        body: [
          'You can choose not to connect a wallet unless you want to access modes or features that require it. You can also stop using Slop Heroes at any time.',
          'Requests about account or data access can be sent through the official Slop Heroes support or community channels.',
        ],
      },
      {
        title: 'Children',
        body: [
          'Slop Heroes is not intended for children under 13. If you believe a child has provided personal information, contact us through the official support channels.',
        ],
      },
    ],
  },
};

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const page = LEGAL_COPY[kind];

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${page.title} | Slop Heroes`;

    return () => {
      document.title = previousTitle;
    };
  }, [page.title]);

  return (
    <main className="legal-page">
      <article className="legal-page__document">
        <header className="legal-page__header">
          <p className="legal-page__eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p className="legal-page__intro">{page.intro}</p>
          <p className="legal-page__updated">Last updated: {LAST_UPDATED}</p>
        </header>

        <div className="legal-page__sections">
          {page.sections.map((section) => (
            <section className="legal-page__section" key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}

export default LegalPage;
