/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "https",
        hostname: "ipfs.io",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "sock.cauldron.quest",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "i.ibb.co",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "gist.githubusercontent.com",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "gist.github.com",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "ipfs.pat.mn",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "**.ipfs.dweb.link",
        port: "",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "**.ipfs.nftstorage.link",
        port: "",
        pathname: "**",
      },
    ],
  },
};

// bafkreigyby3j4ue7oxw6ucpojflzbt24x7vik7rp2sjqnfme6d2cfyjdea.ipfs.nftstorage.link
// https://bafybeiekc4wo27tmfi26zzujs3qfn2z5osncs74zzdr53l52apu2toswzm.ipfs.dweb.link
module.exports = nextConfig;
