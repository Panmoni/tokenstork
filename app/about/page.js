export default function Page() {
  return (
    <main className="px-1 sm:px-2 lg:px-4 text-base">
      <h2 className="text-4xl font-extrabold mb-4">
        <span className="text-transparent bg-clip-text bg-gradient-to-r to-accent from-primary">
          About Token Stork
        </span>
      </h2>
      <p>
        TokenStork.com is a market-cap site for BCH{" "}
        <a href="https://cashtokens.org/" target="_blank">
          CashTokens
        </a>{" "}
        built and maintained by{" "}
        <a href="https://georgedonnelly.com/">George Donnelly</a>.{" "}
        <a href="https://github.com/Panmoni/tokenstork" target="_blank">
          The code is open-source
        </a>
        . You can review the pending{" "}
        <a href="https://github.com/Panmoni/tokenstork/issues" target="_blank">
          issues
        </a>{" "}
        or the{" "}
        <a
          href="https://github.com/Panmoni/tokenstork/projects?query=is%3Aopen"
          target="_blank"
        >
          roadmap
        </a>
        . I welcome your suggestions, criticisms, bug reports and general
        feedback any time.
      </p>

      <h3 className="text-2xl my-4">Need Help Building?</h3>
      <p>
        Want to build a dapp on BCH but need some technical help?{" "}
        <strong>Hire me!</strong> Email{" "}
        <a href="mailto:george@panmoni.com">george@panmoni.com</a> and I will
        build what you need!
      </p>

      <h3 className="text-2xl my-4">Get the Latest BCH News</h3>
      <p>
        Join{" "}
        <a href="https://www.reddit.com/r/BCHCashTokens/" target="_blank">
          r/BCHCashTokens
        </a>
        , the only remaining censorship-free BCH subreddit where everything
        related to BCH is on-topic.
      </p>
      <h3 className="text-2xl my-4">Support</h3>
      <p className="mb-4">
        At this time, this site is self-funded and running on borrowed APIs, as
        well lending an API to others, so please consider supporting this work
        by donating to the following address:
      </p>
      <p className="text-lg">
        bitcoincash:qz3pxmwda8gd42wa8k9yfxcwhcaapeuhygjc8mc4m8
      </p>

      <h3 className="text-2xl my-4">Acknowledgments</h3>
      <p className="my-4">
        TokenStork is made possible through the provision of technical
        assistance, APIs, etc by the following. Thank you for your
        collaboration!
      </p>
      <ul className="list-disc list-inside ml-5">
        <li>
          a&nbsp;
          <a
            href="https://www.paytaca.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="Thank you"
          >
            Paytaca
          </a>
          &nbsp;API
        </li>
        <li>
          <a
            href="https://twitter.com/mainnet_pat"
            target="_blank"
            rel="noopener noreferrer"
            title="mainnet_pat"
          >
            mainnet_pat&apos;s
          </a>
          &nbsp;Chaingraph server (donation sent)
        </li>
        <li>
          <a
            href="https://cauldron.quest/"
            target="_blank"
            rel="noopener noreferrer"
            title="BCH informational website"
          >
            Cauldron Swap
          </a>
        </li>
        <li>
          <a
            href="https://www.coingecko.com/en"
            target="_blank"
            rel="noopener noreferrer"
            title="CoinGecko"
          >
            CoinGecko
          </a>
        </li>
        <li>
          <a
            href="https://www.bitcoincashsite.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="BCH informational website"
          >
            BCH
          </a>
        </li>
        <li>
          <a
            href="https://twitter.com/GeukensMathieu"
            target="_blank"
            rel="noopener noreferrer"
            title="Twitter"
          >
            Mathieu Geukens
          </a>
        </li>
        <li>
          <a
            href="https://twitter.com/dagur"
            target="_blank"
            rel="noopener noreferrer"
            title="Twitter"
          >
            Dagur
          </a>
        </li>
      </ul>
      <h3 className="text-2xl my-4">Contact</h3>
      <p>
        Please email <a href="mailto:hello@panmoni.com">hello@panmoni.com</a>{" "}
        and we&apos;ll be thrilled to assist you.
      </p>
    </main>
  );
}
