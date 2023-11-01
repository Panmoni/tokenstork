// footer.tsx

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTwitter,
  faInstagram,
  faYoutube,
  faReddit,
  faDiscord,
  faTelegram,
  faGithub,
} from "@fortawesome/free-brands-svg-icons";

const Footer = () => {
  return (
    <footer className="py-4 px-6 mb-20">
      <div className="footer-content">
        <p className="attribution">
          A&nbsp;
          <a
            href="https://www.panmoni.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="Panmoni is a Web3 product studio"
            className="unset gradient-link tracking-wider font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#00abda] to-[#1476ff] hover:after:bg-gradient-to-r hover:after:from-[#00abda] hover:after:to-[#1476ff] astro-C44LKZXB"
          >
            Panmoni
          </a>{" "}
          project. Prices in USD.
        </p>
        <div className="footer-links">
          <a href="privacy.txt" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          |
          <a href="tos.txt" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>
          |
          <a title="Email Panmoni" href="mailto:hello@panmoni.com">
            Contact
          </a>
          | version 0.0.1 beta
        </div>

        <div className="footer-social-links">
          <a
            href="https://twitter.com/bitcoincashsite"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FontAwesomeIcon icon={faTwitter} className="footer-fa-icons" />
          </a>
          <a
            href="https://t.me/Panmoni/487"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FontAwesomeIcon icon={faTelegram} className="footer-fa-icons" />
          </a>
          <a
            href="https://www.reddit.com/r/BCHCashTokens/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FontAwesomeIcon icon={faReddit} className="footer-fa-icons" />
          </a>
          <a
            href="https://www.youtube.com/@RealBitcoinCashSite"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FontAwesomeIcon icon={faYoutube} className="footer-fa-icons" />
          </a>
          <a
            href="https://www.instagram.com/bitcoincashsite"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FontAwesomeIcon icon={faInstagram} className="footer-fa-icons" />
          </a>
          <a
            href="https://github.com/Panmoni/tokenstork"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FontAwesomeIcon icon={faGithub} className="footer-fa-icons" />
          </a>
        </div>
        <p className="disclaimer">
          <strong>Disclaimer</strong>: Cryptocurrency investments carry a high
          degree of risk, and may not be suitable for all investors. Before
          deciding to trade cryptocurrencies, you should carefully consider your
          investment objectives, level of experience, and risk appetite. The
          possibility exists that you could sustain a loss of some or all of
          your initial investment. Therefore, you should not invest money that
          you cannot afford to lose. This website is for informational purposes
          only and is not intended to provide specific financial, investment,
          tax, legal, accounting or other advice.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
