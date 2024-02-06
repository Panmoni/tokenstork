export default function Page() {
  return (
    <main className="px-1 sm:px-2 lg:px-4 text-base">
      <h2 className="text-4xl font-extrabold mb-4">
        <span className="text-transparent bg-clip-text bg-gradient-to-r to-accent from-primary">
          Roadmap
        </span>
      </h2>
      <p className="mb-2">
        TokenStork.com aims to be a market-cap website for BCH CashTokens, but
        it also aims to be a comprensive service provider for on-chain
        CashTokens operations and data. Working with CashTokens should be smooth
        and easy, and TokenStork.com aims to make it that way.
      </p>
      <div className="grid gap-6 mt-8">
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-green-500" />
          <div>
            <h3 className="text-lg font-semibold">0.0.3</h3>
            <p className="text-gray-500">
              Inner pages, fully responsive UI, set up database to store data,
              speed up page loads, volume and price change stats.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-green-500" />
          <div>
            <h3 className="text-lg font-semibold">0.0.4</h3>
            <p className="text-gray-500">
              Themes, more data via API calls, NFT tab, search bar for tokens,
              SEO polishing, auth.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-green-500" />
          <div>
            <h3 className="text-lg font-semibold">0.0.5</h3>
            <p className="text-gray-500">
              Optimize loading time, show fees in header.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.0.6</h3>
            <p className="text-gray-500">
              List all NFT projects, integrate tapswap.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.1.0</h3>
            <p className="text-gray-500">
              Tokens searchable via tags, integrate WalletConnect, comprehensive
              error-handling and tests, accessibility, ability to create FTs and
              NFTs via form.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.2.0</h3>
            <p className="text-gray-500">
              Ability to create ICOs via form with accountability, DAO
              formation, etc.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.5.0</h3>
            <p className="text-gray-500">
              Ability to create BCMR identities for people and organizations;
              add portfolio/watchlist functionality with updates when BCMRs
              change.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.7.0</h3>
            <p className="text-gray-500">
              Add token management tools (metadata updates, dividends, mass
              distribution, airdrops, ability to secure authbase, etc.)
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">1.0.0</h3>
            <p className="text-gray-500">
              Add other pertinent BCH chain data; run own chaingraph and BCMR
              servers;offer/track additional products that require on-chain
              contracts.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function CheckIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ClockIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
