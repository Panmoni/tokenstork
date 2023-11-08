import TinyLoader from "@/app/components/TinyLoader";

// TODO: generate the skeleton programatically when tokenIDs updates, use Image and other optimizations, create a script for it, need to replace certain fields with the loader, add mr-2 to Images, use Image instead of img, etc.

const TokenSkeleton = () => {
  return (
    <main className="px-1 sm:px-2 lg:px-4 text-lg">
      <h2 className="text-3xl font-extrabold mb-4">
        <span className="text-transparent bg-clip-text bg-gradient-to-r to-accent from-primary">
          Today&apos;s BCH CashTokens Prices by Total Value Locked
        </span>
      </h2>
      <div>
        <div className="tremor-Table-root overflow-auto mt-6 animate-pulse">
          <table className="tremor-Table-table w-full tabular-nums text-tremor-default text-tremor-content dark:text-dark-tremor-content">
            <thead className="tremor-TableHead-root text-left text-tremor-content dark:text-dark-tremor-content">
              <tr className="tremor-TableRow-row">
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap text-left font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5">
                  Name
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap text-left font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5">
                  Ticker
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5 text-right">
                  Price ($)
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5 text-right">
                  Circulating Supply
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center text-tremor-brand dark:text-dark-tremor-brand px-1.5 py-1.5 align-middle">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </span>
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5 text-right">
                  Max Supply
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center text-tremor-brand dark:text-dark-tremor-brand px-1.5 py-1.5 align-middle">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </span>
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5 text-right">
                  Market Cap ($)
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center text-tremor-brand dark:text-dark-tremor-brand px-1.5 py-1.5 align-middle">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </span>
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5 text-right">
                  TVL ($)
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center text-tremor-brand dark:text-dark-tremor-brand px-1.5 py-1.5 align-middle">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </span>
                </th>
                <th className="tremor-TableHeaderCell-root sticky whitespace-nowrap font-semibold text-tremor-content dark:text-dark-tremor-content top-0 px-4 py-3.5 text-right">
                  Token Category
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center text-tremor-brand dark:text-dark-tremor-brand px-1.5 py-1.5 align-middle">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clip-rule="evenodd"
                      ></path>
                    </svg>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="tremor-TableBody-root align-top overflow-x-auto divide-y divide-tremor-border dark:divide-dark-tremor-border !opacity-100">
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="WōK"
                    title="A token of the LAWminati DAO"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmabDdWy8wzcio6AR11Bo7xcqB5Dd47oftn1kbG69iWvaW&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmabDdWy8wzcio6AR11Bo7xcqB5Dd47oftn1kbG69iWvaW&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmabDdWy8wzcio6AR11Bo7xcqB5Dd47oftn1kbG69iWvaW&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="A token of the LAWminati DAO"
                  >
                    WōK
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  ō
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/5fa49b2cb281c87af59e74dd10d391b3d255849cab1ba49f5c953dff1947829b"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    5fa49...7829b
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Furu Tokens"
                    title="FURU tokens are the official free-play tokens for the BCH Guru predictions platform."
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreicqqq3tkq5tkbtg3vhbhw6urybothpoedsszuejs5baq2k25mhgvu&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreicqqq3tkq5tkbtg3vhbhw6urybothpoedsszuejs5baq2k25mhgvu&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreicqqq3tkq5tkbtg3vhbhw6urybothpoedsszuejs5baq2k25mhgvu&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="FURU tokens are the official free-play tokens for the BCH Guru predictions platform."
                  >
                    Furu Tokens
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  FURU
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  1B
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    d9ab2...f96ea
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="DogeCash"
                    title="Created for fun on the CashTokens launch day, distributed through giveaways &amp; airdrops. Don't let your dreams be memes"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fgist.githubusercontent.com%2Fmr-zwets%2F84b0057808af20df392815fb27d4a661%2Fraw%2FDogecoin_Logo.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fgist.githubusercontent.com%2Fmr-zwets%2F84b0057808af20df392815fb27d4a661%2Fraw%2FDogecoin_Logo.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fgist.githubusercontent.com%2Fmr-zwets%2F84b0057808af20df392815fb27d4a661%2Fraw%2FDogecoin_Logo.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Created for fun on the CashTokens launch day, distributed through giveaways &amp; airdrops. Don't let your dreams be memes"
                  >
                    DogeCash
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  DOGECASH
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  140B
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/8473d94f604de351cdee3030f6c354d36b257861ad8e95bbc0a06fbab2a2f9cf"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    8473d...2f9cf
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Jesus Piece"
                    title="Decentralize Structured Religion"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmTXuMscUEHyy3VyBWFVWgBb1yLGofGB9VmSq2uFF9z9fM&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmTXuMscUEHyy3VyBWFVWgBb1yLGofGB9VmSq2uFF9z9fM&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmTXuMscUEHyy3VyBWFVWgBb1yLGofGB9VmSq2uFF9z9fM&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Decentralize Structured Religion"
                  >
                    Jesus Piece
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  HOLY
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  77.78M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/67f37913382a5ffcde88dbd689faf7098d7dcb92a93dd49878bd8ed64b80a85b"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    67f37...0a85b
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="cLoWnFLEX"
                    title="In honour of Lark Mamb, NotSoSmartBCH and all Other Rugs"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmev5pGFZNAQLukwTBHCpvqmSXDD841VA6bHq5fxLYXRWs&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmev5pGFZNAQLukwTBHCpvqmSXDD841VA6bHq5fxLYXRWs&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmev5pGFZNAQLukwTBHCpvqmSXDD841VA6bHq5fxLYXRWs&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="In honour of Lark Mamb, NotSoSmartBCH and all Other Rugs"
                  >
                    cLoWnFLEX
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  cFLEX
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  420.69K
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/e9fed7ad0b4ece9e7f6a4f9644264467f5ce410ea20f32e0e7adc147d5e5180d"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    e9fed...5180d
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Spice Token"
                    title="SPICE is the ultimate expression of appreciation in the world of memes. As a fun and lighthearted token, it celebrates the joy and humor that memes bring to our lives. While SPICE holds no intrinsic value, it thrives on the sheer enjoyment and collective spirit of its community. SPICE serves as a digital high-five, a virtual thumbs-up, and a way to say, 'Hey, your meme game is on fire!'. It embodies the spirit of camaraderie and the shared laughter that unites meme enthusiasts across the internet."
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fi.ibb.co%2F6sJknMy%2Fspice-logo.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fi.ibb.co%2F6sJknMy%2Fspice-logo.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fi.ibb.co%2F6sJknMy%2Fspice-logo.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="SPICE is the ultimate expression of appreciation in the world of memes. As a fun and lighthearted token, it celebrates the joy and humor that memes bring to our lives. While SPICE holds no intrinsic value, it thrives on the sheer enjoyment and collective spirit of its community. SPICE serves as a digital high-five, a virtual thumbs-up, and a way to say, 'Hey, your meme game is on fire!'. It embodies the spirit of camaraderie and the shared laughter that unites meme enthusiasts across the internet."
                  >
                    Spice Token
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  SPICE
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  2B
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/de980d12e49999f1dbc8d61a8f119328f7be9fb1c308eafe979bf10abb17200d"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    de980...7200d
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Microfi Free Flow"
                    title="Microfi Free Flow (XMI) is a crypto-asset with no profit incentive, other than asset-referenced token or e-money token. The token is used to power the Microfi Free Flow Project, show appreciation, commemorate special events or express creativity. XMI can be a valuable asset for those who value the low supply of tokens, sentimental and collector's value and are not afraid of the speculative nature of crypto-assets."
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafybeiekc4wo27tmfi26zzujs3qfn2z5osncs74zzdr53l52apu2toswzm&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafybeiekc4wo27tmfi26zzujs3qfn2z5osncs74zzdr53l52apu2toswzm&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafybeiekc4wo27tmfi26zzujs3qfn2z5osncs74zzdr53l52apu2toswzm&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Microfi Free Flow (XMI) is a crypto-asset with no profit incentive, other than asset-referenced token or e-money token. The token is used to power the Microfi Free Flow Project, show appreciation, commemorate special events or express creativity. XMI can be a valuable asset for those who value the low supply of tokens, sentimental and collector's value and are not afraid of the speculative nature of crypto-assets."
                  >
                    Microfi Free Flow
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  XMI
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  1M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/b69f76548653033603cdcb81299e3c1d1f3d61ad66e7ba0e6569b493605b4cbe"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    b69f7...b4cbe
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Bismuth Win Bi Token"
                    title="Loyalty points issued by Bismuth Shed, an e-commerce store specializing in bismuth crystals and ores.

Bismuth Shed was founded in 2017 and is based in Taipei City, Taiwan. Bismuth Shed also offers pickup orders near MRT Taipei Nangang Exhibition Center Station.

 The token has been created on May 15th 2023.

 At time of creation on mainnet, the token also existed on BNB and SmartBCH blockchain, as contract 0x2e1da8eb00cd1ff9b201f51e3705d87e06313881 on both. "
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fgist.githubusercontent.com%2FBiWinBi%2F16a92d06305a727674a1131379dfd4e9%2Fraw%2FLogo.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fgist.githubusercontent.com%2FBiWinBi%2F16a92d06305a727674a1131379dfd4e9%2Fraw%2FLogo.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fgist.githubusercontent.com%2FBiWinBi%2F16a92d06305a727674a1131379dfd4e9%2Fraw%2FLogo.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Loyalty points issued by Bismuth Shed, an e-commerce store specializing in bismuth crystals and ores.

Bismuth Shed was founded in 2017 and is based in Taipei City, Taiwan. Bismuth Shed also offers pickup orders near MRT Taipei Nangang Exhibition Center Station.

 The token has been created on May 15th 2023.

 At time of creation on mainnet, the token also existed on BNB and SmartBCH blockchain, as contract 0x2e1da8eb00cd1ff9b201f51e3705d87e06313881 on both. "
                  >
                    Bismuth Win Bi Token
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  BWBT
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/36546e4062a1cfd070a4a8d8ff9db18aae4ddf8d9ac9a4fa789314d108b49797"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    36546...49797
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Real Bitcoin Fam Community Award Tokens"
                    title="Real Bitcoin Fam's community award token for rewarding new BCH builders who are building with Cash Tokens. Real Bitcoin Fam is a support network for Bitcoin, cryptocurrency and Web3 builders who align with an OG Bitcoin vibe."
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreiax4h2evyf4g7iuu6kuqkxwez4kvduxayngj5vxmvgrekipevptl4&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreiax4h2evyf4g7iuu6kuqkxwez4kvduxayngj5vxmvgrekipevptl4&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreiax4h2evyf4g7iuu6kuqkxwez4kvduxayngj5vxmvgrekipevptl4&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Real Bitcoin Fam's community award token for rewarding new BCH builders who are building with Cash Tokens. Real Bitcoin Fam is a support network for Bitcoin, cryptocurrency and Web3 builders who align with an OG Bitcoin vibe."
                  >
                    Real Bitcoin Fam Com...
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  XRBF
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/482d555258d3be69fef6ffcd0e5eeb23c4aaacec572b25ab1c21897600c45887"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    482d5...45887
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Bitcoin Cash 𝕏"
                    title="Bitcoin Cash Decentralized Exchange"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreidhofzqmsb5gf7wdvnqwbe74ryxje3vto7miyo2ywsid2pwbk475m&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreidhofzqmsb5gf7wdvnqwbe74ryxje3vto7miyo2ywsid2pwbk475m&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreidhofzqmsb5gf7wdvnqwbe74ryxje3vto7miyo2ywsid2pwbk475m&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Bitcoin Cash Decentralized Exchange"
                  >
                    Bitcoin Cash 𝕏
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  BCHX
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/7955dd3bdbdd0a4f1ff3316865a0995416dd9d9b05e0d075b075069428e64cc4"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    7955d...64cc4
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Cauldron Developer Snapshot Mana 2023"
                    title="For risk seekers, willing to risk it all in the danger zone. By holding mana, you accept the risk of stepping into the bleeding edge. By wielding this Mana, you explicitly acknowledge and accept the unpredictable forces at play, ready to harness the raw, untested magic of the next-gen decentralized frontier. Venture with caution, for here be dragons."
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fsock.cauldron.quest%2Fblueorb.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fsock.cauldron.quest%2Fblueorb.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fsock.cauldron.quest%2Fblueorb.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="For risk seekers, willing to risk it all in the danger zone. By holding mana, you accept the risk of stepping into the bleeding edge. By wielding this Mana, you explicitly acknowledge and accept the unpredictable forces at play, ready to harness the raw, untested magic of the next-gen decentralized frontier. Venture with caution, for here be dragons."
                  >
                    Cauldron Developer S...
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  MANA2023
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  108M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/4ef5cf7feae104cff07259bd29ad2173d42658db3e6aceba30c847596db78fbc"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    4ef5c...78fbc
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Africa Unite"
                    title="Africa Unite is a token built on CashTokens"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftangoswap-cash%2Fassets%2Fmaster%2Fblockchains%2Fsmartbch%2Fassets%2F0x4EA4A00E15B9E8FeE27eB6156a865525083e9F71%2Flogo.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftangoswap-cash%2Fassets%2Fmaster%2Fblockchains%2Fsmartbch%2Fassets%2F0x4EA4A00E15B9E8FeE27eB6156a865525083e9F71%2Flogo.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftangoswap-cash%2Fassets%2Fmaster%2Fblockchains%2Fsmartbch%2Fassets%2F0x4EA4A00E15B9E8FeE27eB6156a865525083e9F71%2Flogo.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Africa Unite is a token built on CashTokens"
                  >
                    Africa Unite
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  Martin₿
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  100T
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/5438105b673cbc062326daaa71d91889d3b1754386132d5bd9c9cd212fea536f"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    54381...a536f
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="HASHMOB"
                    title="$HASH"
                    loading="lazy"
                    width="32"
                    height="32"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreigyby3j4ue7oxw6ucpojflzbt24x7vik7rp2sjqnfme6d2cfyjdea&amp;w=32&amp;q=75 1x, /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreigyby3j4ue7oxw6ucpojflzbt24x7vik7rp2sjqnfme6d2cfyjdea&amp;w=64&amp;q=75 2x"
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafkreigyby3j4ue7oxw6ucpojflzbt24x7vik7rp2sjqnfme6d2cfyjdea&amp;w=64&amp;q=75"
                  />
                  <span className="align-middle font-semibold" title="$HASH">
                    HASHMOB
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  HASH
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/391241c4ebc7ee249434da3bd7aaadf58db9294962cff999f9317c266e4ae020"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    39124...ae020
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Belly"
                    title="Inspired by the currency in the popular anime and manga series One Piece. "
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcryptobugnft%2Finvalidcash-token-registry%2Fmain%2FBelly.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcryptobugnft%2Finvalidcash-token-registry%2Fmain%2FBelly.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcryptobugnft%2Finvalidcash-token-registry%2Fmain%2FBelly.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Inspired by the currency in the popular anime and manga series One Piece. "
                  >
                    Belly
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  BELLY
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  100T
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/b62431202f3da15b3f1cb1f8f187731d7e0d25933ddfce781368960a983e985e"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    b6243...e985e
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Test Token #2"
                    title="Test token 2"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1637136772227268608%2FnBUBqz7Y_400x400.jpg&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1637136772227268608%2FnBUBqz7Y_400x400.jpg&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F1637136772227268608%2FnBUBqz7Y_400x400.jpg&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Test token 2"
                  >
                    Test Token #2
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  TEST2
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  1M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/9efbad475f0fb80fb5f30e27a7432d625694996e23c227880887483b85979788"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    9efba...79788
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Popcorn!"
                    title="Popcorn! (Created by a Decentralized Autonomous Popcorn Stand)"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmQZiH5Qm793qsnhFjF3F8jB3ADYusofE5WBEu4tMuH7mv&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmQZiH5Qm793qsnhFjF3F8jB3ADYusofE5WBEu4tMuH7mv&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.io%2Fipfs%2FQmQZiH5Qm793qsnhFjF3F8jB3ADYusofE5WBEu4tMuH7mv&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Popcorn! (Created by a Decentralized Autonomous Popcorn Stand)"
                  >
                    Popcorn!
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  POPCORN
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  9.22E
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/02a690fadd8e3ff5539726c6eca6c2b8039bce945634d78ac46b1db26a8a0eaf"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    02a69...a0eaf
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Cauldron Socks"
                    title="Cauldron socks"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fsock.cauldron.quest%2Fsock.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fsock.cauldron.quest%2Fsock.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fsock.cauldron.quest%2Fsock.png&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Cauldron socks"
                  >
                    Cauldron Socks
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  SOCK
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  500
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/b79bfc8246b5fc4707e7c7dedcb6619ef1ab91f494a790c20b0f4c422ed95b92"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    b79bf...95b92
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="BitcoinCashTV"
                    title="BCHTV is a Variety Gaming Show where you can win Bitcoin Cash daily!"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmeTHACo1GsxsXbwPk9NgYPsmH5an1js2pMvAcFqRjtxJk&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmeTHACo1GsxsXbwPk9NgYPsmH5an1js2pMvAcFqRjtxJk&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmeTHACo1GsxsXbwPk9NgYPsmH5an1js2pMvAcFqRjtxJk&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="BCHTV is a Variety Gaming Show where you can win Bitcoin Cash daily!"
                  >
                    BitcoinCashTV
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  BCHTV
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/f6677f3d3805d70949b375d36e094ff0ec9ece2a2cb1fde6d8b0e90b368f1f63"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    f6677...f1f63
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="Cashcats"
                    title="$cats"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fgist.github.com%2Falpsy05%2F948dc4d353379a6aeef7daaed2863dfe%2Fraw%2F0ed348912c2fb0a439bec08d3e8fa58d46013ab2%2Fcashcats.png&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fgist.github.com%2Falpsy05%2F948dc4d353379a6aeef7daaed2863dfe%2Fraw%2F0ed348912c2fb0a439bec08d3e8fa58d46013ab2%2Fcashcats.png&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fgist.github.com%2Falpsy05%2F948dc4d353379a6aeef7daaed2863dfe%2Fraw%2F0ed348912c2fb0a439bec08d3e8fa58d46013ab2%2Fcashcats.png&amp;w=64&amp;q=75"
                  />
                  <span className="align-middle font-semibold" title="$cats">
                    Cashcats
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  CATS
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  1B
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/8bc2ebc1547257265ece8381f3ed6aa573c5aa8a23e0f552dc7128bb8a8e6f0f"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    8bc2e...e6f0f
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
              <tr className="tremor-TableRow-row">
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  <img
                    alt="🅢🅐🅣🅞🅢🅗🅘🅟🅛🅐🅨 🅵🆄🅽 🅲🅾🆄🅿🅾🅽🆂"
                    title="Cash Tokens Redeemable for In-Site Use/Play @ www.satoshiplay.co.uk"
                    loading="lazy"
                    width="28"
                    height="28"
                    decoding="async"
                    data-nimg="1"
                    className="rounded-full inline align-middle mr-2 animate-spin"
                    srcSet="
                  /_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmQH7H8wxXmr5cH28mUAGEhCTvQ895Lot6vVjHRn38AZYs&amp;w=32&amp;q=75 1x,
                  /_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmQH7H8wxXmr5cH28mUAGEhCTvQ895Lot6vVjHRn38AZYs&amp;w=64&amp;q=75 2x
                "
                    src="/_next/image?url=https%3A%2F%2Fipfs.pat.mn%2Fipfs%2FQmQH7H8wxXmr5cH28mUAGEhCTvQ895Lot6vVjHRn38AZYs&amp;w=64&amp;q=75"
                  />
                  <span
                    className="align-middle font-semibold"
                    title="Cash Tokens Redeemable for In-Site Use/Play @ www.satoshiplay.co.uk"
                  >
                    🅢🅐🅣🅞🅢🅗🅘🅟🅛🅐...
                  </span>
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums text-left p-4">
                  PLAY
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  21M
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <TinyLoader />
                </td>
                <td className="tremor-TableCell-root align-middle whitespace-nowrap tabular-nums p-4 text-right">
                  <a
                    href="https://explorer.salemkode.com/token/cc805fb1a702fe4c326fb83d06250005a51623e65fd4449c34d8ae207afdc08b"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on SalemKode Explorer"
                    className="font-mono"
                  >
                    cc805...dc08b
                  </a>
                  <span className="tremor-Icon-root inline-flex flex-shrink-0 items-center dark:text-dark-tremor-brand px-1.5 py-1.5 cursor-pointer align-middle hover:text-accent text-primary">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      aria-hidden="true"
                      className="tremor-Icon-icon shrink-0 h-5 w-5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      ></path>
                    </svg>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
};

export default TokenSkeleton;
