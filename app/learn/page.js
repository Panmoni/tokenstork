export default function Page() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-600 to-indigo-500 bg-clip-text text-transparent mb-6">
        Learn
      </h1>
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p className="text-slate-600 dark:text-slate-300 mb-6">
          To get started, here are two foundational CashTokens tutorials.
          We&apos;ll be adding more resources to this page soon.
        </p>
        <ul className="space-y-4 text-slate-600 dark:text-slate-300">
          <li className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <a
              href="https://bchworks.com/blog/token-pioneers-cashtokens-tutorial-1"
              target="_blank"
              className="text-violet-600 hover:underline font-medium"
            >
              Mint your First CashTokens on Bitcoin Cash (Token Pioneers Tutorial 1)
            </a>
          </li>
          <li className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <a
              href="https://bchworks.com/blog/token-pioneers-cashtokens-tutorial-2"
              target="_blank"
              className="text-violet-600 hover:underline font-medium"
            >
              Mint your First NFTs on Bitcoin Cash (Token Pioneers Tutorial 2)
            </a>
          </li>
          <li className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <a
              href="https://bchworks.com/blog/token-pioneers-cashtokens-tutorial-3"
              target="_blank"
              className="text-violet-600 hover:underline font-medium"
            >
              Understanding and Working with BCMR: CashTokens Metadata (Token Pioneers Tutorial 3)
            </a>
          </li>
          <li className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <a
              href="https://bchworks.com/blog/token-pioneers-cashtokens-tutorial-4"
              target="_blank"
              className="text-violet-600 hover:underline font-medium"
            >
              Create an NFT Ticket & Warrant Canary with CashTokens Parsable NFTs (Token Pioneers Tutorial 4)
            </a>
          </li>
        </ul>
      </div>
    </main>
  );
}