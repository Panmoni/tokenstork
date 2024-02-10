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
            <h3 className="text-lg font-semibold">0.0.3 Server-Side Data</h3>
            <ul className="list-disc list-inside text-gray-500">
              <li>
                set up a database to store token data and speed up page loads.
              </li>
              <li>
                load the website from the server, instead of from client-side
                APIs.
              </li>
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-green-500" />
          <div>
            <h3 className="text-lg font-semibold">
              0.0.4 Individual Token Pages
            </h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add detailed individual token pages, with data, news, socials,
                recent token transactions, number of holders, etc.
              </li>
              <li>incorporate volume, price change stats from Cauldron.</li>
              <li>add buy buttons that link to Cauldron.</li>
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-green-500" />
          <div>
            <h3 className="text-lg font-semibold">0.0.5 NFT Tab</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add an NFT tab with NFT collections, recent mints, number minted
                per category, floor price on TapSwap (via chaingraph queries),
                number of unique addresses, etc, and links to buy on TapSwap.
              </li>
              <li>add individual NFT collection pages.</li>
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.0.7 Accessibility</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>add themes, light and dark mode.</li>
              <li>optimize accessibility (aria, etc).</li>
              <li>optimize SEO.</li>
              <li>optimize loading time.</li>
              <li>
                expand header data (chain fees, ecosystem TVL, number of
                markets, 24h volume, FURU dominance, halving countdown,
                S&amp;P500 price performance, inflation, treasury rate, etc.).
              </li>
              <li>add token search bar .</li>
              <li>add tags to tokens .</li>
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">
              0.1.0 Easy Fungible Tokens
            </h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>add authentication / user accounts.</li>
              <li>integrate WalletConnect (or CashConnect, if ready).</li>
              <li>
                add the ability to create fungible tokens/BCMR via web form.
              </li>
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">
              0.2.0 Token Management and Tracking
            </h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add token management tools (metadata updates, ability to secure
                authbase, etc.)
              </li>
              <li>add token watchlist functionality.</li>
              <li>add token upvote/downvote functionality.</li>
            </ul>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.3.0 The Front Page</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                on the front page, show prices in sats and various currencies
                (dropdown)
              </li>
              <li>show 1h, 24h &amp; 7d price performance</li>
              <li>show a 7d price spark graph</li>
              <li>
                show trending tokens, recently-added tokens, most-upvoted
                tokens, most downvoted, etc.
              </li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.4.0 BCMR</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add ability to create BCMR identities for people and
                organizations.
              </li>
              <li>enable updates when and show a log of BCMR changes.</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.5.0 Forming Businesses</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add the ability to create ICOs via form with
                accountability/milestones, transparency, etc.
              </li>
              <li>add a dividend distribution tool</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.6.0 Tracking Growth</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add exchanges tab (volumes, change in volume 24h, pairs, date of
                founding).
              </li>
              <li>add portfolio functionality.</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">
              0.7.0 Expanding Opportunities
            </h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>add a dapps tab.</li>
              <li>add a news tab.</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.8.0 Social </h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                enable people to login and leave comments and reviews on tokens,
                exchanges, dapps, NFT series, etc.
              </li>
              <li>add a chat squawkbox.</li>
              <li>
                give token owners access to edit their token pages, and base the
                access on control of the authhead.
              </li>
              <li>add an airdrops page with coming and past airdrop events.</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">0.9.0 Tools</h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                tools (compare 2 tokens, watchlist/portfolio feature, embeddable
                widgets, price alerts, profit calculator, ecosystem overview
                charts)
              </li>
              <li>add heat maps (market share by token)</li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <ClockIcon className="w-6 h-6 text-yellow-500" />
          <div>
            <h3 className="text-lg font-semibold">
              1.0.0 Monetization &amp; Marketing
            </h3>

            <ul className="list-disc list-inside text-gray-500">
              <li>
                add monetization options (merch store?, offer an API, select
                advertising, supporters/patrons)
              </li>
              <li>
                run a small marketing campaign around the idea of tokenizing
                your assets on BCH.
              </li>
              <li>
                do outreach to 20 companies to see if we can build some
                partnerships to tokenize real-world assets on-chain with
                CashTokens, e.g., gold, silver and other commodities.
              </li>
            </ul>
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
