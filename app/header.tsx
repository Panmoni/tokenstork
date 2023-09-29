// header.tsx

import Image from "next/image";

const Header = () => {
  return (
    <header>
      <div className="logo">
        <h1>
          <a href="/">
            <Image
              src="/logo-simple-bch.png"
              alt="TokenStork - Delivering beautiful new CashTokens on BCH since 2023"
              width={553}
              height={100}
              title="TokenStork - Delivering beautiful new CashTokens on BCH since 2023"
            />
          </a>
        </h1>
      </div>

      <nav>
        <ul className="nav-links">
          <li>
            <a title="Create your own CashTokens" href="#">
              Create Tokens
            </a>
          </li>
          <li>
            <a title="Create a BCH wallet" href="#">
              Wallet
            </a>
          </li>
          <li>
            <a title="Learn more about TokenStork" href="about/">
              About
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
};

export default Header;
