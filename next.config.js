/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
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

module.exports = nextConfig;
