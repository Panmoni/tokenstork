export default function Page() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
        Roadmap
      </h1>
      <p className="text-slate-600 dark:text-slate-300 mb-8">
        TokenStork.com aims to be a market-cap website for BCH CashTokens, but
        it also aims to be a comprehensive service provider for on-chain
        CashTokens operations and data. Working with CashTokens should be smooth
        and easy, and TokenStork.com aims to make it that way.
      </p>

      <div className="space-y-6">
        {/* 0.0.3 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.0.3 Server-Side Data</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Set up a database to store token data and speed up page loads.</li>
                <li>Load the website from the server, instead of from client-side APIs.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.0.4 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.0.4 Individual Token Pages</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add detailed individual token pages, with data, news, socials, recent token transactions, number of holders, etc.</li>
                <li>Incorporate volume, price change stats from Cauldron.</li>
                <li>Add buy buttons that link to Cauldron.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.0.5 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.0.5 NFT Tab</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add an NFT tab with NFT collections, recent mints, number minted per category, floor price on TapSwap, number of unique addresses, etc.</li>
                <li>Add individual NFT collection pages.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.0.7 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.0.7 Accessibility</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add themes, light and dark mode.</li>
                <li>Optimize accessibility (aria, etc).</li>
                <li>Optimize SEO.</li>
                <li>Optimize loading time.</li>
                <li>Expand header data (chain fees, ecosystem TVL, number of markets, 24h volume, etc.).</li>
                <li>Add token search bar.</li>
                <li>Add tags to tokens.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.1.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.1.0 Easy Fungible Tokens</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add authentication / user accounts.</li>
                <li>Integrate WalletConnect (or CashConnect, if ready).</li>
                <li>Add the ability to create fungible tokens/BCMR via web form.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.2.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.2.0 Token Management and Tracking</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add token management tools (metadata updates, ability to secure authbase, etc.)</li>
                <li>Add token watchlist functionality.</li>
                <li>Add token upvote/downvote functionality.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.3.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.3.0 The Front Page</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>On the front page, show prices in sats and various currencies (dropdown)</li>
                <li>Show 1h, 24h &amp; 7d price performance</li>
                <li>Show a 7d price spark graph</li>
                <li>Show trending tokens, recently-added tokens, most-upvoted tokens, etc.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.4.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.4.0 BCMR</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add ability to create BCMR identities for people and organizations.</li>
                <li>Enable updates when and show a log of BCMR changes.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.5.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.5.0 Forming Businesses</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add the ability to create ICOs via form with accountability/milestones, transparency, etc.</li>
                <li>Add a dividend distribution tool.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.6.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.6.0 Tracking Growth</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add exchanges tab (volumes, change in volume 24h, pairs, date of founding).</li>
                <li>Add portfolio functionality.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.7.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.7.0 Expanding Opportunities</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add a dapps tab.</li>
                <li>Add a news tab.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.8.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.8.0 Social</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Enable people to login and leave comments and reviews on tokens, exchanges, dapps, NFT series, etc.</li>
                <li>Add a chat squawkbox.</li>
                <li>Give token owners access to edit their token pages, and base the access on control of the authhead.</li>
                <li>Add an airdrops page with coming and past airdrop events.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 0.9.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">0.9.0 Tools</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Tools (compare 2 tokens, watchlist/portfolio feature, embeddable widgets, price alerts, profit calculator, ecosystem overview charts)</li>
                <li>Add heat maps (market share by token)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 1.0.0 */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">1.0.0 Monetization &amp; Marketing</h3>
              <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-2 space-y-1">
                <li>Add monetization options (merch store?, offer an API, select advertising, supporters/patrons)</li>
                <li>Run a small marketing campaign around the idea of tokenizing your assets on BCH.</li>
                <li>Do outreach to 20 companies to see if we can build some partnerships to tokenize real-world assets on-chain with CashTokens.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}