import Image from "next/image";

const BottomCards = () => {
  return (
    <section className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 px-4">
      <div className="transform transition duration-500 hover:scale-105 bg-gradient-to-br from-accent to-accent-light shadow-lg rounded-lg overflow-hidden my-10">
        <a
          target="_blank"
          rel="noopener noreferrer"
          href="https://x.com/BitcoinCashSite"
          className="block relative"
        >
          <Image
            src="/socials/twitter.png"
            alt="@BitcoinCashSite"
            className="object-cover object-center rounded-full h-36 w-36 mx-auto mt-10 bg-white border border-primary"
            height={36}
            width={36}
          />
        </a>
        <h3 className="py-2 w-3/4 text-black text-xl font-semibold tracking-wide uppercase mx-auto text-center my-4">
          Follow @BitcoinCashSite
        </h3>
        <p className="px-6 mx-auto text-center">
          Follow @BitcoinCashSite on 𝕏 to stay up-to-date with the BCH and
          CashTokens space!
        </p>
        <p className="mt-4 mb-6 mx-auto text-center">
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://x.com/BitcoinCashSite"
            className="px-5 py-2.5 font-medium bg-primary hover:bg-accent !text-white rounded-lg text-sm no-underline"
          >
            Follow @BitcoinCashSite
          </a>
        </p>
      </div>
      <div className="transform transition duration-500 hover:scale-105 bg-gradient-to-br from-primary to-primary-light shadow-lg rounded-lg overflow-hidden my-10">
        <a
          target="_blank"
          rel="noopener noreferrer"
          href="https://reddit.com/r/BCHCashTokens"
          className="block relative"
        >
          <Image
            src="/socials/reddit.png"
            alt="r/BCHCashTokens"
            className="object-cover object-center rounded-full h-36 w-36 mx-auto mt-10 border border-accent"
            height={36}
            width={36}
          />
        </a>
        <h3 className="py-2 w-3/4 text-black text-xl font-semibold tracking-wide uppercase mx-auto text-center my-4">
          Subscribe to r/BCHCashTokens
        </h3>
        <p className="px-6 mx-auto text-center">
          Subscribe to r/BCHCashTokens to stay up-to-date with the BCH and
          CashTokens space!
        </p>
        <p className="mt-4 mb-6 mx-auto text-center">
          <a
            target="_blank"
            rel="noopener noreferrer"
            href="https://reddit.com/r/BCHCashTokens"
            className="px-5 py-2.5 font-medium bg-primary hover:bg-accent !text-white rounded-lg text-sm no-underline"
          >
            Subscribe to r/BCHCashTokens
          </a>
        </p>
      </div>
      <div className="transform transition duration-500 hover:scale-105 bg-gradient-to-br from-secondary to-secondary-light shadow-lg rounded-lg w-full mx-auto overflow-hidden my-10 p-6">
        <div className="text-xl font-semibold mb-2">
          Magnitude Abbreviations
        </div>
        <p className="mb-4">For the token supply numbers.</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-gray-700 col-span-1">1 (no abbr.)</div>
          <div className="font-mono col-span-2">1</div>
          <div className="text-gray-700 col-span-1">Thousand (K)</div>
          <div className="font-mono col-span-2">1K = 1,000</div>
          <div className="text-gray-700 col-span-1">Million (M)</div>
          <div className="font-mono col-span-2">1M = 1,000,000</div>
          <div className="text-gray-700 col-span-1">Billion (B)</div>
          <div className="font-mono col-span-2">1B = 1,000,000,000</div>
          <div className="text-gray-700 col-span-1">Trillion (T)</div>
          <div className="font-mono col-span-2">1T = 1,000,000,000,000</div>
          <div className="text-gray-700 col-span-1">Quadrillion (P)</div>
          <div className="font-mono col-span-2">1P = 1,000,000,000,000,000</div>
          <div className="text-gray-700 col-span-1">Quintillion (E)</div>
          <div className="font-mono col-span-2">
            1E = 1,000,000,000,000,000,000
          </div>
        </div>
      </div>
    </section>
  );
};

export default BottomCards;
