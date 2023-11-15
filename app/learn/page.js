export default function Page() {
  return (
    <main className="px-1 sm:px-2 lg:px-4 text-base">
      <h2 className="text-4xl font-extrabold mb-4">
        <span className="text-transparent bg-clip-text bg-gradient-to-r to-accent from-primary">
          Learn
        </span>
      </h2>
      <p className="mb-2">
        To get started, here are two foundational CashTokens tutorials.
        We&apos;ll be adding more resources to this page soon.
      </p>
      <ul className="list-disc list-inside ml-5">
        <li>
          <a
            href="https://www.bitcoincashsite.com/blog/token-pioneers-cashtokens-tutorial-1"
            target="_blank"
          >
            Mint your First CashTokens on Bitcoin Cash (Token Pioneers Tutorial
            1)
          </a>
        </li>
        <li>
          <a
            href="https://www.bitcoincashsite.com/blog/token-pioneers-cashtokens-tutorial-2"
            target="_blank"
          >
            Mint your First NFTs on Bitcoin Cash (Token Pioneers Tutorial 2)
          </a>
        </li>
      </ul>
    </main>
  );
}
