// TODO: the grid is set too high up so it affects this page and breaks the whole thing.

export default function Page() {
  return (
    <main className="container mx-auto py-6 block">
      <h2 className="text-3xl mb-4">About Token Stork</h2>
      <p>
        TokenStork.com is a market-cap site for BCH CashTokens built and
        maintained by{" "}
        <a href="https://georgedonnelly.com/" target="_blank">
          George Donnelly
        </a>
        .{" "}
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
        .
      </p>

      <h3 className="text-2xl my-4">Get the Latest BCH News</h3>

      <p>
        Join{" "}
        <a href="https://www.reddit.com/r/BCHCashTokens/" target="_blank">
          r/BCHCashTokens
        </a>
        .
      </p>

      <h3 className="text-2xl my-4">Support</h3>

      <p>bitcoincash:qz3pxmwda8gd42wa8k9yfxcwhcaapeuhygjc8mc4m8</p>

      <h3 className="text-2xl my-4">Contact</h3>

      <p>
        Please email <a href="mailto:hello@panmoni.com">hello@panmoni.com</a>{" "}
        and we&apos;ll be thrilled to assist you.
      </p>

      <h3 className="text-2xl my-4">Acknowledgments</h3>

      <p className="my-4">
        TokenStork is made possible through the provision of technical
        assistance, APIs, etc by the following. Thank you for your
        collaboration!
      </p>
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
        &nbsp;Chaingraph server
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
    </main>
  );
}
