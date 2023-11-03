import Image from "next/image";

const Header = () => {
  return (
    <header>
      <div>
        <h1>
          <a href="/">
            <Image
              src="/logo-simple-bch.png"
              alt="TokenStork - Delivering beautiful new CashTokens on BCH since 2023"
              width={553}
              height={100}
              title="TokenStork - Delivering beautiful new CashTokens on BCH since 2023"
              priority={true}
            />
          </a>
        </h1>
      </div>

      <nav>
        <ul>
          <li>
            <a title="New homepage" href="/table">
              Table
            </a>
          </li>
          <li>
            <a title="Learn more about TokenStork" href="/about">
              About
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
};

export default Header;
