export default function Page() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
        About Token Stork
      </h1>
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          TokenStork.com is a market-cap site for{" "}
          <a href="https://bchworks.com/" target="_blank" className="text-violet-600 hover:underline">
            BCH
          </a>{" "}
          <a href="https://cashtokens.org/" target="_blank" className="text-violet-600 hover:underline">
            CashTokens
          </a>{" "}
          built and maintained by{" "}
          <a href="https://georgedonnelly.com/" target="_blank" className="text-violet-600 hover:underline">
            George Donnelly
          </a>
          .{" "}
          <a href="https://github.com/Panmoni/tokenstork" target="_blank" className="text-violet-600 hover:underline">
            The code is open-source
          </a>
          . You can review the pending{" "}
          <a href="https://github.com/Panmoni/tokenstork/issues" target="_blank" className="text-violet-600 hover:underline">
            issues
          </a>{" "}
          or the{" "}
          <a href="/roadmap" className="text-violet-600 hover:underline">
            roadmap
          </a>
          .
        </p>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          I welcome your suggestions, criticisms, bug reports and general feedback
          any time. Let me know what functionality would be of assistance to you,
          and I will probably add it!
        </p>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">TokenStork Flipstarter</h2>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          The TokenStork flipstarter is now live! Give it a look and maybe make a
          pledge:{" "}
          <a href="https://flipstarter.tokenstork.com/en" target="_blank" className="text-violet-600 hover:underline">
            TokenStork Flipstarter.
          </a>
        </p>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Need Help Building?</h2>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          Want to build a dapp on BCH but need some technical help?{" "}
          <strong>Hire me!</strong> Email{" "}
          <a href="mailto:george@panmoni.com" className="text-violet-600 hover:underline">george@panmoni.com</a> and I will
          build what you need!
        </p>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Get the Latest BCH News</h2>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          Join{" "}
          <a href="https://www.reddit.com/r/BCHCashTokens/" target="_blank" className="text-violet-600 hover:underline">
            r/BCHCashTokens
          </a>
          , the only remaining censorship-free BCH subreddit where everything
          related to BCH is on-topic.
        </p>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">TokenStork BCH Metadata Registry</h2>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          TokenStork now also hosts{" "}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://tokenstork.com/.well-known/bitcoin-cash-metadata-registry.json"
            className="text-violet-600 hover:underline"
          >
            TokenStorkRegistry
          </a>
          , a BCH Metadata Registry. PRs are welcome at our{" "}
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://github.com/Panmoni/tokenstork/blob/main/public/.well-known/bitcoin-cash-metadata-registry.json"
            className="text-violet-600 hover:underline"
          >
            GitHub repo
          </a>
          . For now, the registry mirrors{" "}
          <a target="_blank" rel="noopener noreferrer" href="https://otr.cash" className="text-violet-600 hover:underline">
            otr.cash
          </a>
          .
        </p>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Support</h2>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          At this time, this site is self-funded and running on borrowed APIs, as
          well lending an API to others, so please consider supporting this work
          by donating to the following address. Thank you!
        </p>
        <p className="text-lg font-mono bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-lg text-slate-900 dark:text-white mb-6">
          bitcoincash:qz3pxmwda8gd42wa8k9yfxcwhcaapeuhygjc8mc4m8
        </p>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Acknowledgments</h2>
        <p className="text-slate-600 dark:text-slate-300 mb-4">
          TokenStork is made possible through the provision of technical
          assistance, APIs, etc by the following. Thank you for your
          collaboration!
        </p>
        <ul className="list-disc list-inside ml-6 text-slate-600 dark:text-slate-300 space-y-2 mb-6">
          <li>
            <a href="https://www.paytaca.com/" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
              Paytaca
            </a>
            &nbsp;API
          </li>
          <li>
            <a href="https://twitter.com/mainnet_pat" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
              mainnet_pat&apos;s
            </a>
            &nbsp;Chaingraph server (donation sent)
          </li>
          <li>
            <a href="https://cauldron.quest/" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
              Cauldron Swap
            </a>
          </li>
          <li>
            <a href="https://www.coingecko.com/en" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
              CoinGecko
            </a>
          </li>
          <li>
            <a href="https://bchworks.com/" target="_blank" className="text-violet-600 hover:underline">
              BCH
            </a>
          </li>
          <li>
            <a href="https://twitter.com/GeukensMathieu" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
              Mathieu Geukens
            </a>
          </li>
          <li>
            <a href="https://twitter.com/dagur" target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
              Dagur
            </a>
          </li>
        </ul>

        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mt-8 mb-4">Contact</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Please email <a href="mailto:hello@panmoni.com" className="text-violet-600 hover:underline">hello@panmoni.com</a>{" "}
          and we&apos;ll be thrilled to assist you.
        </p>
      </div>
    </main>
  );
}