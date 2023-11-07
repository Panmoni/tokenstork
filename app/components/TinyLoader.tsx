export default function TinyLoader() {
  return (
    <div className="inline-flex items-center justify-center space-x-1">
      <div className="w-1 h-1 rounded-full animate-pulse bg-accent"></div>
      <div className="w-1 h-1 rounded-full animate-pulse bg-accent"></div>
      <div className="w-1 h-1 rounded-full animate-pulse bg-accent"></div>
    </div>
  );
}

// TODO: consider making this a small spinning BCH logo or something else interesting, or maybe changing it seasonally
