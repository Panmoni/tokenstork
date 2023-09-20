// footer.tsx

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTwitter,
  faInstagram,
  faYoutube,
  faDiscord,
  faTelegram,
  faGithub,
} from "@fortawesome/free-brands-svg-icons";

const Footer = () => {
  return (
    <footer>
      <div className="footer-content">
        <p className="attribution">
          TokenStork "Delivering beautiful new CashTokens on BCH since 2023" is
          a{" "}
          <a
            href="https://www.panmoni.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="Panmoni is a Web3 product studio"
          >
            Panmoni{" "}
          </a>
          project made possible by a{" "}
          <a
            href="https://www.paytaca.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="Thank you"
          >
            Paytaca{" "}
          </a>
          API,{" "}
          <a
            href="https://twitter.com/mainnet_pat"
            target="_blank"
            rel="noopener noreferrer"
            title="mainnet_pat"
          >
            mainnet_pat's{" "}
          </a>
          Chaingraph and{" "}
          <a
            href="https://www.bitcoincashsite.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="BCH informational website"
          >
            BCH{" "}
          </a>
          with help from{" "}
          <a
            href="https://twitter.com/GeukensMathieu"
            target="_blank"
            rel="noopener noreferrer"
            title="Twitter"
          >
            Mathieu Geukens
          </a>
          .
        </p>
        <p className="support">
          <strong>Support</strong>:
          bitcoincash:qz3pxmwda8gd42wa8k9yfxcwhcaapeuhygjc8mc4m8 |
          bitcoincash:zz3pxmwda8gd42wa8k9yfxcwhcaapeuhyg4j59kny5
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
