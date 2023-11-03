const Headers = () => {
  const headers = [
    "Name",
    "Price",
    "Circulating Supply",
    "Max Supply",
    "Market Cap",
    "TVL",
    "Category",
    "Links",
  ];

  return (
    <div>
      {headers.map((header) => (
        <div key={header}>{header}</div>
      ))}
    </div>
  );
};

export default Headers;
